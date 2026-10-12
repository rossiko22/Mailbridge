# Ticket Mail – Outlook Ticketing System

Spletna aplikacija za obravnavo Outlookove pošte kot podpornih zahtevkov. Uporablja Node.js 24, Express 5, TypeScript, PostgreSQL 18 ter HTML/CSS/JavaScript. En strežnik ponuja uporabniški vmesnik in API; ena namestitev uporablja en poštni predal.

Podprti so prijava in odjava, uporabniške vloge, ustvarjanje članov ekipe, sprememba gesla, Microsoft OAuth oziroma Microsoft 365 aplikacijske poverilnice, sinhronizacija Inboxa, iskanje in filtri, dodeljevanje, zaključevanje in ponovno odpiranje zahtevkov, zgodovina, odgovori, posredovanje, nova sporočila, priloge in izvoz EML.

## Dokumentacija za oddajo 1. naloge

- [Izbira projekta in obseg](documentation/izbira-projekta.md)
- [Vzpostavitvena dokumentacija](documentation/vzpostavitev.md)
- [Ključne funkcionalnosti in demonstracija](documentation/funkcionalnosti.md)
- [Stanje testiranja in zagotavljanja kakovosti](documentation/stanje-testiranja-in-zagotavljanja-kakovosti.md)
- [Uporaba generativne umetne inteligence](documentation/uporaba-ui.md)

## Produkcijska uporaba z resničnim Outlookom

- [Microsoft Outlook: potrebni podatki, dovoljenja in povezava](documentation/microsoft-graph.md)
- [Namestitev na strežnik, HTTPS, nadgradnje in varnostne kopije](documentation/produkcija.md)
- [API in pravila dostopa](documentation/api.md)

Produkcijski paket vključuje Dockerfile, PostgreSQL, Caddy za HTTPS, trajne seje in šifrirano hrambo Microsoftovih žetonov. Potrebujete svoj strežnik, domeno, Microsoftovo registracijo aplikacije ter veljavne poverilnice. Samodejni testi simulirajo Microsoftove odzive in ne pošiljajo dejanske pošte. Po vnosu novega žetona je bila 12. 10. 2026 uspešno preverjena resnična sinhronizacija, delta nadaljevanje, originalni EML, priloga in brskalniški prikaz. Produkcijski OAuth in dejanska dostava pošte še zahtevata preverjanje z vašimi podatki. To ni že objavljena javna namestitev.

## Hiter lokalni zagon

```sh
npm ci
cp .env-example .env
# Uporabite obstoječo .env, če jo že imate; ne prepišite svojih nastavitev.
docker compose up -d postgres
npm run migration
npm run seed
npm run dev
```

Odprite <http://localhost:3000>. Privzeti primer nastavitev uporablja lokalni demonstracijski način brez dostopa do Microsofta:

| Račun | Geslo | Vloga |
| --- | --- | --- |
| `manager@example.test` | `Manager-Test-123!` | IT Manager in lastnik demo predala |
| `developer@example.test` | `Developer-Test-123!` | Član ekipe; vidi njemu dodeljene zahtevke |

Demo gesel in `npm run seed` ne uporabljajte v produkciji. Skripta za seed zavrne okolje, ki ni `development`. Za resnično pošto nastavite OAuth po [navodilih](documentation/microsoft-graph.md).

## Preverjanje

```sh
npm run check           # TypeScript, enotski/pogodbeni testi, produkcijska kompilacija
npm run test:database   # Prava PostgreSQL baza; lastni testni podatki se odstranijo
npx playwright install chromium
npm run test:browser    # Pravi brskalnik, strežnik in baza; Microsoft je simuliran
npm run test:setup      # Začasna baza; zahteva dovoljenje CREATEDB
npm run test:deployment # Docker slika, začasna baza, produkcijski zagon in backup/restore
```

Podroben obseg, izvedeni rezultati, omejitve ter uporaba AI so v dokumentu [Stanje testiranja in zagotavljanja kakovosti](documentation/stanje-testiranja-in-zagotavljanja-kakovosti.md).

Avtor projekta: Marko Spasovski. Pri dopolnitvah kode, testov in dokumentacije je bil uporabljen OpenAI Codex; glejte [izjavo](documentation/uporaba-ui.md).
