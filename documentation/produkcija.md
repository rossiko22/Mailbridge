# Produkcijska namestitev in vzdrževanje

Podprt paket je namenjen eni manjši ekipi in enemu predalu na Linux strežniku z Docker Compose. Aplikacija teče kot uporabnik `node`, PostgreSQL ima trajni volumen, Caddy pa je edina javno izpostavljena storitev. Strežniški del posluša na notranjih vratih 3000, PostgreSQL na notranjih 5432. Javne povezave potekajo prek HTTPS.

Paket je preverjen z gradnjo in izoliranim produkcijskim smoke testom. **To ne pomeni že objavljene ali neodvisno varnostno certificirane namestitve.** Pred prevzemom potrebujete resnične Microsoftove podatke in izvedbo sprejemnega preizkusa.

## 1. Kaj pripraviti

- Linux strežnik z Docker Engine in Compose v2; začetna praktična velikost za manjšo ekipo je vsaj 2 GiB RAM in disk glede na obseg pošte ter kopij. Obremenitveni SLA ni izmerjen.
- Domena z A/AAAA zapisom na strežnik. Obstoječ napačen AAAA zapis popravite ali odstranite.
- Dostopna TCP vrata 80 in 443; UDP 443 je omogočen za HTTP/3. Aplikacijskih in podatkovnih vrat ne odpirajte javno.
- Izhodni HTTPS do Microsoft login/Graph in ACME ter DNS; registri so potrebni med gradnjo.
- [Microsoftova registracija, dovoljenja in podatki](microsoft-graph.md).
- Ločeno varno mesto za skrivnosti in zunajstrežniške varnostne kopije.

Caddy ob pravilnem DNS in dosegljivih vratih pridobi in obnavlja certifikat. Podrobni pogoji so v [uradni dokumentaciji Caddy](https://caddyserver.com/docs/automatic-https). Compose čaka na označene zdrave odvisnosti; glejte [Docker startup order](https://docs.docker.com/compose/how-tos/startup-order/).

## 2. Konfiguracija

V repozitoriju na strežniku:

```sh
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Tri različne naključne vrednosti uporabite za `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` in `POSTGRES_PASSWORD`. Uredite `.env.production` in zamenjajte **vse** primere `REPLACE_` ter domene/naslove. `APP_DOMAIN`, `PUBLIC_ORIGIN` in OAuth callback morajo opisovati isto domeno. `.env.production` je ignorirana v Git in Docker build kontekstu.

Za osebni Outlook nastavite `GRAPH_AUTH_MODE=oauth` in `GRAPH_TENANT_ID=consumers`. Za Microsoft 365 app-only uporabite `application` in tenant UUID. V obeh primerih nastavite `GRAPH_OWNER_EMAIL` na lokalni račun, ki ga boste ustvarili v naslednjem koraku. Kopirani Graph Explorer žetoni so v produkciji zavrnjeni.

`TRUST_PROXY=1` predpostavlja točno en zaupanja vreden proxy (priloženi Caddy). Ne izpostavite aplikacije neposredno in ne dodajajte drugih posrednikov brez prilagoditve te meje zaupanja. Sprememba `POSTGRES_PASSWORD` v datoteki sama ne zamenja gesla že inicializirane baze.

## 3. Baza, slika in migracije

Vse ukaze izvajajte iz korena repozitorija:

```sh
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml up -d postgres
docker compose --env-file .env.production -f compose.production.yaml build app
docker compose --env-file .env.production -f compose.production.yaml run --rm app npm run migration:prod
```

Migracije morajo biti izvedene pred prvim zagonom. Ne izvajajo se samodejno pri vsakem zagonu; tako se nadgradnje lahko načrtujejo. Ponovna izvedba že izvedenih migracij ne spremeni podatkov. Zagonski pregled preveri povezavo in prisotnost potrebnih tabel.

## 4. Prvi administrator

Naslednji primer je za Bash; geslo se vnese skrito in ni argument v zgodovini ukazov:

```sh
read -r -p 'Email administratorja (enak GRAPH_OWNER_EMAIL): ' BOOTSTRAP_ADMIN_EMAIL
read -r -s -p 'Novo geslo (vsaj 16 znakov): ' BOOTSTRAP_ADMIN_PASSWORD
printf '\n'
export BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
docker compose --env-file .env.production -f compose.production.yaml run --rm -e BOOTSTRAP_ADMIN_EMAIL -e BOOTSTRAP_ADMIN_PASSWORD app npm run admin:create
unset BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
```

Skripta ustvari IT Manager račun. Obstoječega računa ne prepiše ali samodejno poviša. Za obnovitev izgubljenega gesla uporabite operaterski `admin:reset-password`, opisan spodaj. **Ne izvajajte demo seeda v produkciji.**

## 5. Zagon in povezava Outlooka

```sh
docker compose --env-file .env.production -f compose.production.yaml up -d app caddy
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 app caddy
```

1. Odprite `https://VAŠA-DOMENA` in preverite veljaven certifikat.
2. Prijavite se z ustvarjenim administratorjem.
3. OAuth: **Settings → Connect Microsoft Outlook**. App-only: nastavitev je na strežniku, interaktivna povezava ni potrebna.
4. Izvedite **Sync now**.
5. V Settings ustvarite sodelavce. Uporabljajte močna začetna gesla in varen kanal za njihovo predajo; uporabniki jih lahko spremenijo sami.
6. Izvedite [sprejemni preizkus resnične pošte](microsoft-graph.md#preverjanje-prave-povezave).

Bralno preverjanje Microsofta:

```sh
docker compose --env-file .env.production -f compose.production.yaml exec app npm run outlook:check
```

## 6. Nadzor in varnostne kopije

- `/health` preverja dosegljivost PostgreSQL in vrne `{"status":"ok"}`; ni preverjanje dostavljivosti pošte ali veljavnosti Microsoftovega soglasja.
- Docker healthcheck spremlja aplikacijo. Spremljajte tudi razpoložljiv disk, stanje baze, 5xx/429, iztek client secreta in uspešnost varnostnih kopij.
- Produkcijski zapisi vsebujejo naključen `X-Request-ID`, metodo, pot **brez query parametrov**, status in trajanje. Ne zapisujejo teles, gesel, OAuth kod ali žetonov. Dockerjeva dnevnika app/Caddy imata omejeno rotacijo.
- Omejitve prijav so skupne procesom v PostgreSQL: 10 poskusov na račun in 50 na IP v 15 minutah. Ključi so HMAC povzetki, ne goli e-naslovi/IP naslovi. Zapisi starejši od dneva se odstranjujejo med prijavami.
- Sejni piškotek ima HttpOnly, SameSite=Lax in v produkciji Secure. Drsna seja traja 8 ur. Gesla so Argon2id; sprememba gesla prekliče obstoječe seje.
- Vključen je CSP brez inline skript, prepoved vstavljanja strani v okvirje, no-sniff, no-referrer in preverjanje izvora JSON sprememb.

Varnostna kopija:

```sh
./deploy/backup.sh
```

Skripta ustvari PostgreSQL custom-format dump v `backups/` z omejenimi pravicami datoteke. Kopije prenesite šifrirano izven strežnika in določite politiko hrambe. Volumen ni varnostna kopija. Ločeno varno hranite `TOKEN_ENCRYPTION_KEY`; brez njega shranjene Microsoftove povezave po obnovitvi niso berljive. Lokalni izvoz EML ni kopija uporabnikov, sej ali zgodovine zahtevkov.

Preizkus obnovitve izvedite v **novi** bazi, ne nad delujočimi podatki:

```sh
docker compose --env-file .env.production -f compose.production.yaml exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" ticket_mail_restore_check'
docker compose --env-file .env.production -f compose.production.yaml exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d ticket_mail_restore_check --exit-on-error' < backups/IZBRANA-KOPIJA.dump
docker compose --env-file .env.production -f compose.production.yaml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d ticket_mail_restore_check -c "SELECT count(*) FROM users;"'
```

Za pravo obnovitev ustavite app, pripravite obnovljeno bazo, preverite vsebino in nastavitve, preusmerite `POSTGRES_DB` ter ponovno zaženite. Ne prepisujte izvirne baze, dokler obnovitev ni potrjena. Demonstracijski smoke test avtomatsko preverja `pg_dump`/`pg_restore` na ločenih začasnih vsebnikih.

## 7. Nadgradnja in povrnitev

1. Preglejte spremembe in zaženite CI/teste na stagingu.
2. Ustvarite ter preverite varnostno kopijo.
3. Shranite prejšnjo sliko:

   ```sh
   docker image tag ticket-mail:local ticket-mail:before-update
   ```

4. Pridobite pregledano izdajo in izvedite:

   ```sh
   docker compose --env-file .env.production -f compose.production.yaml build app
   docker compose --env-file .env.production -f compose.production.yaml run --rm app npm run migration:prod
   docker compose --env-file .env.production -f compose.production.yaml up -d --no-deps app
   ```

5. Preverite zdravje, prijavo, delo z zahtevkom in povezavo Outlooka.

Za povrnitev kode uporabite prejšnjo sliko samo, če je združljiva z novo shemo:

```sh
docker image tag ticket-mail:before-update ticket-mail:local
docker compose --env-file .env.production -f compose.production.yaml up -d --no-deps --force-recreate app
```

Samodejna razveljavitev migracij ni vključena. Pri nezdružljivi shemi je potrebna načrtovana obnovitev baze. Produkcijske slike pred izdajo označite z verzijo/commitom in po potrebi pripnite digest osnovnih slik; predloge uporabljajo vzdrževani oznaki Node 24 in PostgreSQL 18.

## 8. Rotacija in obnovitev dostopa

**Geslo uporabnika:** uporabnik ga spremeni v Settings. Če se ne more prijaviti, operater v varni lupini nastavi `RESET_USER_EMAIL` in `RESET_USER_PASSWORD` ter izvede:

```sh
docker compose --env-file .env.production -f compose.production.yaml run --rm -e RESET_USER_EMAIL -e RESET_USER_PASSWORD app npm run admin:reset-password
```

Sledi odstranitev obeh spremenljivk iz okolja. Geslo mora imeti vsaj 16 znakov; stare seje so preklicane. Javni e-poštni »forgot password« ni implementiran.

**Client secret:** pred iztekom ustvarite novega v Entra, spremenite strežniško skrivnost, ponovno ustvarite vsebnik app in preverite povezavo; šele nato odstranite starega v Microsoftu.

**SESSION_SECRET:** menjava odjavi uporabnike. Ker ima produkcija ločen šifrirni ključ, Microsoftov cache ostane berljiv.

**TOKEN_ENCRYPTION_KEY:** neposredna menjava onemogoči branje obstoječega cachea. Načrtujte ponovno Microsoftovo povezavo v Settings oziroma migracijo šifriranih podatkov; ključ vedno varno kopirajte. Že uvožena sporočila niso odvisna od tega ključa.

## Preverjeno in še potrebno

Preverjeni so gradnja, prazna shema, provisioning, neprivilegiran/read-only zagon, varni piškotki ob simuliranem HTTPS proxyju, API in obnovitev kopije. Javna izdaja certifikata, DNS, resničen Microsoftov OAuth, obnova pravega žetona in dostava pravega sporočila zahtevajo vaše produkcijske podatke. Prav tako niso izvedeni neodvisen penetracijski pregled, daljši obremenitveni test, visoka razpoložljivost ali revizija skladnosti za občutljivo pošto.
