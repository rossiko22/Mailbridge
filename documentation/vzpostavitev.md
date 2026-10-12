# Vzpostavitvena dokumentacija

## Zahteve

- Node.js **24 ali novejši** in npm; preverjeno z Node.js 24.21.0.
- PostgreSQL **18**; Docker Compose v2 je najpreprostejši način za lokalno bazo.
- Sodobni brskalnik z JavaScriptom.
- Za brskalniške teste Playwright Chromium (`npx playwright install chromium`; Linux lahko potrebuje `--with-deps`).
- Za resnično Outlookovo pošto Microsoftova registracija aplikacije in račun; za lokalne demo zahtevke Microsoftov račun ni potreben.

Projekt nima ločene gradnje uporabniškega vmesnika. Strani odpirajte prek Expressa, ne kot `file://`, ker potrebujejo sejne piškotke in API.

## Čista lokalna namestitev

```sh
git clone https://github.com/rossiko22/Ticketing-System-Outlook.git
cd Ticketing-System-Outlook
npm ci
cp .env-example .env
```

Kopirajte primer samo ob prvi namestitvi. Če `.env` že obstaja, nove spremenljivke združite z obstoječo datoteko. Ne prepisujte veljavnih Microsoftovih nastavitev. Privzeta predloga je namenjena razvoju.

```sh
docker compose up -d postgres
docker compose ps
npm run migration
npm run seed
npm run dev
```

Počakajte, da PostgreSQL kaže `healthy`. Odprite <http://localhost:3000>. `npm run dev` spremlja izvorno kodo in `.env`. Po spremembi produkcijske konfiguracije je potreben ponovni zagon vsebnika.

Če uporabljate že nameščen PostgreSQL, preskočite Docker in ustvarite prazno bazo ter v `.env` vnesite pravilnega gostitelja, vrata, uporabnika in geslo. Uporabnik za migracije potrebuje pravice za ustvarjanje tabel, indeksov in funkcij.

### Demonstracijski podatki

`npm run seed` ustvari dva razvojna računa in tri sporočila v `LOCAL_MAILBOX`. Ponovitev ne podvaja sporočil in ne ponastavi obstoječih gesel ali dodelitev.

| E-pošta | Geslo | Namen |
| --- | --- | --- |
| `manager@example.test` | `Manager-Test-123!` | Lastnik demo predala in IT Manager |
| `developer@example.test` | `Developer-Test-123!` | Član ekipe |

`GRAPH_AUTH_MODE=disabled` omogoča lokalno branje, iskanje, dodeljevanje, zaključevanje, zgodovino in besedilni EML. Outlookove funkcije so označene kot nepovezane. Noben gumb ne poroča o uspešnem pošiljanju, če Outlook ni nastavljen.

Demo podatki uporabljajo ločen predal `demo@example.test`. Ob preklopu na resnični `GRAPH_MAILBOX` se prikazuje njegov nabor podatkov. To ni izguba demo podatkov.

## Okoljske spremenljivke

Pravi podatki so v ignorirani `.env` oziroma `.env.production`. Predlogi sta [.env-example](../.env-example) in [.env.production.example](../.env.production.example).

| Spremenljivka | Namen in zahteva |
| --- | --- |
| `NODE_ENV` | `development`, `test` ali `production` |
| `PORT` | Vrata HTTP strežnika; privzeto 3000 |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Obvezna povezava z bazo |
| `SESSION_SECRET` | Podpis seje; v produkciji neodvisna naključna skrivnost z vsaj 32 znaki |
| `TOKEN_ENCRYPTION_KEY` | Ključ za šifriranje Microsoftovih podatkov; v produkciji obvezen, vsaj 32 znakov; lokalno prazna vrednost uporabi `SESSION_SECRET` |
| `PUBLIC_ORIGIN` | V produkciji obvezen `https://domena` brez končne poševnice; uporablja se tudi pri preverjanju izvora zahtev |
| `TRUST_PROXY` | `1` samo za eno zaupanja vredno povratno posredniško plast; lokalno `0` |
| `GRAPH_AUTH_MODE` | `disabled`, `oauth`, `application`, razvojni `access_token`; produkcija zahteva `oauth` ali `application` |
| `GRAPH_MAILBOX` | Resnični ciljni Microsoftov poštni predal |
| `GRAPH_OWNER_EMAIL` | Obstoječi lokalni uporabnik, ki upravlja predal; v produkciji obvezen |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | Microsoftova registracija aplikacije za OAuth ali app-only povezavo |
| `GRAPH_REDIRECT_URI` | OAuth povratni URL, natančno `/emails/connection/callback` na istem izvoru kot aplikacija |
| `GRAPH_ACCESS_TOKEN` | Samo začasni Graph Explorer razvojni žeton |
| `LOCAL_MAILBOX`, `LOCAL_OWNER_EMAIL` | Ločen lokalni demo predal in njegov lastnik |
| `POSTGRES_CONTAINER_NAME`, `POSTGRES_VOLUME_NAME`, `POSTGRES_NETWORK_NAME`, `POSTGRES_DATA_PATH`, `POSTGRES_INITDB_ARGS` | Neobvezne nastavitve lokalnega Docker Compose |
| `APP_DOMAIN`, `ACME_EMAIL` | Produkcijska domena in kontakt za Caddy/ACME |

Microsoftove vrednosti in dovoljenja so podrobno razloženi v [ločenem postopku](microsoft-graph.md). Microsoftovo geslo ni konfiguracijska spremenljivka aplikacije.

## Ukazi

| Ukaz | Rezultat |
| --- | --- |
| `npm ci` | Ponovljiva namestitev iz `package-lock.json` |
| `npm run dev` | Lokalni strežnik s spremljanjem sprememb |
| `npm run "start backend"` | Združljiv vzdevek za razvojni zagon |
| `npm run migration` | Izvede manjkajoče SQL migracije |
| `npm run seed` | Razvojna računa in demo sporočila; samo `development` |
| `npm run build` | Prevede TypeScript v `dist/` |
| `npm start` | Zažene prevedeni strežnik |
| `npm run migration:prod` | Migracije s prevedeno kodo; po `build` oziroma v sliki |
| `npm run admin:create` | Varno ustvari administratorja iz `BOOTSTRAP_ADMIN_EMAIL` in `BOOTSTRAP_ADMIN_PASSWORD`; obstoječega računa ne spremeni |
| `npm run admin:reset-password` | Operaterska ponastavitev iz `RESET_USER_EMAIL` in `RESET_USER_PASSWORD`; prekliče obstoječe seje |
| `npm run outlook:check` | Bralni pregled prave povezave; ne uvaža in ne pošilja sporočil |
| `npm run check` | Preverjanje tipov, enotski testi in gradnja |
| `npm run test:database` | SQL in HTTP integracijski testi |
| `npm run test:browser` | Celovit brskalniški scenarij |
| `npm run test:setup` | Prazna začasna baza, migracije in seed dvakrat ter preverjanje demo prijav |
| `npm run test:deployment` | Gradnja in preizkus produkcijske slike z začasnimi vsebniki |

## Pogoste težave

| Težava | Rešitev |
| --- | --- |
| `npm: command not found` | Namestite/aktivirajte Node.js 24; pri nvm npr. `nvm use 24` |
| Povezava z bazo zavrnjena | Preverite `docker compose ps`, gostitelja, vrata in geslo; znotraj produkcijske mreže je gostitelj `postgres` |
| Baza uporablja drugo geslo kot `.env` | PostgreSQL inicializacijske spremenljivke veljajo ob nastanku volumna; sprememba `.env` ne spremeni obstoječega gesla |
| Vrata 5432 ali ime vsebnika že v uporabi | Nastavite drugačen `POSTGRES_PORT` oziroma ime ali uporabite obstoječo bazo |
| Manjkajoče tabele ob zagonu | Najprej izvedite migracije; strežnik preveri prisotnost tabel |
| Član ekipe ne vidi sporočila | Lastnik mu mora najprej dodeliti zahtevek |
| Prijava 429 | Omejitev je 10 poskusov na račun in 50 na IP v 15 minutah; počakajte |
| Konflikt zahtevka 409 | Osvežite podrobnosti in ponovite spremembo; drug uporabnik je vmes spremenil stanje |
| Brskalnik ni nameščen | `npx playwright install chromium`; možen je tudi `CHROME_BIN=/absolutna/pot/do/chromium npm run test:browser` |
| Ni seje za produkcijskim proxyjem | HTTPS, pravilen `PUBLIC_ORIGIN`, `TRUST_PROXY=1` in zaupni `X-Forwarded-Proto`; aplikacijskih vrat ne izpostavljajte mimo proxyja |

Ustavitev baze: `docker compose stop`. Ukaz `down -v` izbriše trajni volumen; ni del običajnega zagona ali nadgradnje.
