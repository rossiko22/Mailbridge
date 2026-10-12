# Stanje testiranja in zagotavljanja kakovosti

**Projekt:** Ticket Mail – Outlook Ticketing System  
**Pregled:** 11.–12. 10. 2026  
**Izvajanje in priprava dopolnitev:** OpenAI Codex v sodelovanju z avtorjem projekta  
**Namen:** evidenca za 1. nalogo ter ponovljiv pregled tehničnega stanja; ni neodvisen varnostni certifikat.

## Izhodiščno stanje

Repozitorij je ob začetku že vseboval 32 uspešnih testov Node.js: Microsoft Graph odjemalec, transakcijska sinhronizacija, omejitve dostopa, šifriranje žetonov, menjava povezave in uporabniška storitev. Obstajali so tudi trije SQL integracijski skripti in brskalniški skript, odvisen od ročno zagnanega strežnika/CDP brskalnika. TypeScript preverjanje je bilo uspešno.

README in dokumentacija Graph sta kljub temu še opisovala več že implementiranih funkcij kot načrtovane. Manjkala je ponovljiva vzpostavitev in dokument kakovosti. Stran za sestavljanje nove pošte je bila nedokončana, izvoz ni deloval, priloge niso bile prenosljive v aplikaciji. Prva migracija je vsebovala lasten BEGIN/COMMIT znotraj migracijskega runnerja. Pregled je odkril še nepravilne HTTP statuse, odvisnost vseh mail funkcij od Outlook nastavitev ter izgubljanje polj pri delnih delta posodobitvah.

Uporabnik je 12. 10. opozoril na `Invalid Microsoft synchronization cursor.` Resnični Microsoftov odgovor je vseboval obliko `mailFolders('inbox')`, validator pa je sprejemal samo segmentno obliko `mailFolders/inbox`. Dodana je normalizacija dovoljenih poti, ne da bi se spreminjal izvirni URL ali preskočila preverjanja izvora/predala. Dodani so regresijski testi za obe obliki in negativni primeri za druge gostitelje, predale, mape ter nepravilno kodiranje. Tudi HTTP/browser fixture zdaj vrača to resnično opaženo OData obliko.

## Evidenca aktivnosti

Pri vsaki aktivnosti je izrecno navedena uporaba AI. Za avtorstvo starejših prispevkov ni mogoče zanesljivo sklepati samo iz kode; spodnja navedba opisuje delo v tej seji.

| Vrsta aktivnosti | Stanje | Pokriti del rešitve | Orodja/ogrodja | Uporaba AI in preverjanje rezultata |
| --- | --- | --- | --- | --- |
| Pregled izvorne kode in dokumentacije | Izveden; popravki vključeni | Strežnik, SQL, frontend, setup in Graph navodila | Branje kode, `rg`, Git diff | Codex je analiziral in popravljal; ugotovitve preverjene s ciljnimi testi in dejanskimi ukazi; brez neodvisnega človeškega audita |
| Enotski/pogodbeni/regresijski testi | **61/61 uspešnih** | Graph auth, cursor, napake, reply/forward/compose, varnost prenosov, transakcije, dostop, OAuth/PKCE/state, cache, EML, throttling, gesla | `node:test`, `node:assert`, `tsx`, injicirani nadomestki | Codex dopolnil teste; dejanska izvedba `npm test`, negativni primeri in reprodukcija opažene napake; rezultati MSAL/Graph so v teh testih simulirani |
| Statično preverjanje in kompilacija | Uspešno | Produkcijska TypeScript koda v `src/` | TypeScript strict, `npm run typecheck`, `npm run build` | Codex pripravil popravke in gradnjo; preverjeno z izhodno kodo 0; testne fixture datoteke niso del produkcijskega tsconfig |
| SQL integracija | Uspešni 3 skripti | User lookup, deduplikacija/partial updates, dostop, dodeljevanje, optimistično zaklepanje, zaključki, filtri, deduplikacija pošiljanja | PostgreSQL 18.6, `pg`, Node assert | Codex razširil delne delta regresije; izvedba na pravi bazi; testni zapisi se razveljavijo |
| HTTP integracija | Uspešen skript | Prava Express aplikacija + seje + PostgreSQL; login/logout, role, uporabniki, sprememba gesla, validacija, ticket workflow, prenosi, sends, history, token settings | Native fetch, Express, PostgreSQL, sintetični Microsoftov adapter | Codex pripravil; preverjeni statusi in vsebina odgovorov ter SQL učinki, lastni testni zapisi odstranjeni; Microsoftov HTTP simuliran, brez pošiljanja |
| End-to-end brskalnik | Uspešen scenarij | Prava prijava, sync, XSS regresija, filtri, dodelitev, finish/reopen, EML/priloge, reply/forward, compose, zgodovina, settings, ustvarjanje uporabnika, mobilna širina, logout | Playwright 1.64.0, Chromium, Express, PostgreSQL | Codex zamenjal ročno CDP odvisnost s samostojno fixture; preverjeni UI rezultati, downloads in odsotnost JS izjem; Microsoft simuliran |
| Čista vzpostavitev | Uspešno | Prazna začasna baza, vseh 7 migracij, ponovitev migracij, seed dvakrat, dokumentirani računi, 3 demo sporočila in lokalni EML | Node subprocess, PostgreSQL CREATEDB, migracijski runner | Codex pripravil in izvedel; potrjeno brez ročnih popravkov sheme; začasna baza odstranjena |
| Produkcijska gradnja in smoke test | Uspešno | Docker image, runtime odvisnosti, migracije, admin provisioning, non-root/read-only zagon, `/health`, varni piškotki in API | Docker, Node 24, PostgreSQL 18, assert | Codex pripravil paket in test; sveži vsebniki ter sintetične skrivnosti; javni TLS in Microsoft v tem testu nista vključena |
| Obnovitev varnostne kopije | Uspešen osnovni round trip | `pg_dump -Fc` → nova baza → `pg_restore`; primerjava števila uporabnikov | PostgreSQL CLI v deployment testu | Codex pripravil in izvedel; ni preizkus obnovitve velike produkcijske baze ali meritve RTO/RPO |
| Validacija deployment konfiguracije | Uspešno | Lokalni in produkcijski Compose, Caddyfile | `docker compose config --quiet`, `caddy validate` | Codex pripravil; orodji potrdili skladnjo; ni dejanska izdaja javnega certifikata |
| Pregled odvisnosti | Izveden, **0 prijavljenih ranljivosti** v trenutnem production npm auditu | Nameščene produkcijske npm odvisnosti | `npm audit --omit=dev --audit-level=high` | Codex izvedel in preveril rezultat; rezultat je časovno omejen, ne pokriva celotne vsebniške slike ali vseh možnih napak |
| CI | Konfiguriran; lokalni ekvivalenti uspešni | Check, migracije, DB, browser, setup, audit in deployment | GitHub Actions, PostgreSQL service | Codex pripravil workflow; ni trditve, da je že tekel na GitHubu, ker spremembe še niso objavljene |
| Resnična Outlook povezava | Branje in sync potrjena 12. 10.; prvi pregled 11. 10. zavrnjen zaradi starega žetona | Veljaven uporabnikov access token, nadaljevanje shranjenega cursorja, 10 strani uvoza, delta ponovitev, originalni EML | Dejanski Microsoft Graph, prava aplikacijska baza | Codex izvajal samo branje Microsofta in lokalni uvoz; uporabnik zagotovil nov žeton; brez izpisa vsebin ali skrivnosti in brez dejanskega pošiljanja |
| Resnični browser/API in priloga | Uspešno 12. 10. | Lastnik predala, 50→100 straničenje, podrobnosti, besedilni EML, pravi Sync now, vsi mailbox pogledi, settings in prenos priloge | Playwright, začasna operaterska testna seja, resnični Express/PostgreSQL/Graph | Codex izvedel brez izpisa zasebne vsebine; začasna seja odstranjena; login z geslom je ločeno pokrit s sintetičnimi E2E testi |
| Pravi Microsoft OAuth in dostava pošte | **Še ni izvedeno proti pravemu produkcijskemu računu** | Interaktivno soglasje, potek in obnova resničnega žetona, dejanska dostava reply/forward/new | Potrebni Entra podatki in dogovorjeni testni prejemnik | AI implementacija preverjena z MSAL nadomestki in API/browser testi; simulacija ne dokazuje realne dostave ali pravilnosti registracije |
| Neodvisna varnost, zmogljivost, dostopnost | Ni celovito izvedeno | Penetracijski pregled, daljša obremenitev, WCAG audit, HA/DR | Ni vzpostavljenega posebnega postopka | AI pregled ni nadomestilo za neodvisen pregled; ne navajamo izmišljenih rezultatov |

## Izvedeni ukazi in rezultati

```text
npm run check              PASS — TypeScript, 61 testi, produkcijski build
npm run test:database      PASS — users, emails, workflow, HTTP
npm run test:browser       PASS — UI, API in baza; Microsoft simuliran
npm run test:setup         PASS — prazna baza, migracije/seed dvakrat, demo prijave
npm run test:deployment    PASS — slika, provisioning, runtime, backup/restore
npm audit --omit=dev --audit-level=high
                          PASS — 0 prijavljenih ranljivosti
Compose config / Caddy validate
                          PASS — konfiguracija veljavna
```

Brskalnik je bil lokalno zagnan z obstoječim Chromiumom prek `CHROME_BIN`. Na novi napravi uporabite `npx playwright install chromium`; workflow CI namesti tudi Linuxove sistemske odvisnosti. Osnovni testni runner ne potrebuje Microsoftovega računa ali baze. Integracijski testi potrebujejo že migrirano bazo; za čisto vzpostavitev je zahtevana pravica CREATEDB; deployment test potrebuje Docker.

Opazovanje resnične povezave 12. 10.: shranjeni cursor je pred popravkom padel, po popravku je isti cursor uspešno vrnil stran. Uvoz je nadaljeval 10 strani (453 obdelanih zapisov) do zaključka; baza je v tistem trenutku imela **503 zapisov in 503 različnih Graph ID-jev**. Naslednji delta klic je uspel. Originalni EML se je prenesel (45.950 bajtov), prav tako resnična priloga skozi prijavljeni API (148.616 bajtov). Brskalniški pregled je potrdil straničenje 50→100, prikaz, vse poglede, settings in resnični Sync now brez JavaScript izjem. Število sporočil se lahko pozneje spremeni; to je zapis opazovanja, ne pričakovana vrednost testa.

## Kaj testi dokazujejo in česa ne

- Potrjujejo izbrane pozitivne in negativne primere, ne odsotnosti vseh napak. Odstotek code coverage ni izmerjen in ni naveden kot 100 %.
- HTTP/browser testi dejansko uporabljajo Express, Argon2id, sejne piškotke in PostgreSQL. Simuliran je zunanji Microsoft, zato ne potrebujejo resničnega prejemnika.
- Realni bralni/sinhronizacijski pregled potrjuje trenutno konfiguracijo access-token načina; ne nadomesti testiranja produkcijskega OAuth ali app-only tenanta.
- Izvedba secure-cookie testa uporablja zaupan header `X-Forwarded-Proto` na izoliranem vsebniku. To preveri Expressovo proxy konfiguracijo, ne javne DNS/ACME infrastrukture.
- Podatki, potrebni za nedoločene send rezultate, se hranijo z `pending`/`unknown`; ni zagotovila exactly-once dostave v zunanjem poštnem sistemu.
- CI konfiguracija je pripravljena, vendar oddani commit in dejanski GitHub zagon ostajata naloga upravljavca.

## Nadaljnje aktivnosti pred uporabo prave namestitve

1. Konfigurirati lastno Microsoftovo registracijo in javni HTTPS ter izvesti [sprejemni preizkus](microsoft-graph.md#preverjanje-prave-povezave).
2. Z izrecno izbranim prejemnikom preveriti dejanski prejem odgovorov, posredovanj in novih sporočil.
3. Preveriti obnovitev resničnega OAuth dostopa po izteku žetona in ponovno povezavo po preklicu soglasja.
4. Določiti spremljanje, hrambo pošte in kopij, pristojnosti upravljavca ter sprejemljive zmogljivosti.
5. Po oddaji pregledati CI rezultate; za občutljivo produkcijsko pošto opraviti neodvisen varnostni pregled.

Podrobna izjava o AI je v [Uporaba generativne umetne inteligence](uporaba-ui.md).

## Dopolnitev: HTML bralnik in poštni vmesnik (12. 10.)

Codex je dopolnil prikaz pošiljatelja, zadeve, predogleda in kratkega datuma, zložljive filtre in zgodovino ter varni HTML bralnik. Štirje dodatni unit testi pokrivajo tabele in gumbe, odstranjevanje skript/obrazcev/CSS zahtev, opt-in za slike ter ubežanje besedila. HTTP preveri dostop 401/404, CSP, slike in HTML izhod; Playwright preveri dejanski iframe, preklop besedilo/HTML, blokiranje slik do klika in fallback ob 503. Posnetki za vizualni pregled uporabljajo sintetični račun in sintetični račun za naročnino, ne zasebnih sporočil. Pri pravem Outlooku so bili preverjeni štirje HTML odgovori in brskalniški prikaz OpenAI sporočila s šestimi tabelami, dvema povezavama, nič samodejno naloženimi slikami in brez JS izjem. Vdelane CID slike in popolna enakost z Outlookovim CSS niso potrjene funkcije.

### Regresija po poteku žetona

Na dejanskem strežniku `localhost:3000` in računu `developer@example.test` je bil reproduciran HTTP 502 za uporabnikovo sporočilo zaradi poteklega Microsoftovega žetona. Prejšnji pregled je dokazal HTML samo med veljavnostjo žetona in ni zajel tega življenjskega cikla. Migracija 007 dodaja lokalno hrambo uspešno pridobljenih teles v `email_bodies`; pred vsakim dostopom se še vedno preveri obseg uporabnika. HTTP regresija sedaj preveri, da že shranjeni HTML ostane dosegljiv ob zavrnitvi Microsofta, nepridobljeni HTML pa vrne jasno napako povezave in varno oblikovano besedilno kopijo. Dodan je test krajšanja sledilnih URL-jev in odstranitve nevidnega preheader polnila. Izvirne HTML vsebine ni mogoče obnoviti samo iz besedilne kopije: za prvo pridobitev je potreben veljaven Outlook dostop.
