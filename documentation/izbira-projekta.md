# 1. naloga – Izbira projekta

**Projekt:** Ticket Mail – Outlook Ticketing System  
**Avtor:** Marko Spasovski  
**Datum pregleda in dopolnitve:** 11.–12. 10. 2026  
**Repozitorij:** [Ticketing-System-Outlook](https://github.com/rossiko22/Ticketing-System-Outlook)

## Izbrana rešitev in namen

Izbrana je obstoječa lastna spletna rešitev za manjšo podporno oziroma IT-ekipo, ki prejeta Outlookova sporočila obravnava kot zahtevke. Ekipa določi odgovorno osebo, spremlja stanje, odgovarja pošiljateljem ter ohranja sled opravljenega dela. Projekt je dovolj obsežen za nadaljnje vaje, saj povezuje brskalnik, avtentikacijo, poslovna pravila, relacijsko bazo in zunanji Microsoft Graph API.

Projekt presega zahtevanih 8–10 funkcionalnosti. [Specifikacija](funkcionalnosti.md) opredeljuje 16 skupin funkcionalnosti, njihove uporabnike, pričakovane rezultate in preverjanje. Prijava v Ticket Mail je lokalna prijava z geslom; Microsoftova avtorizacija poveže poštni predal in ne nadomesti lokalnega uporabniškega računa.

## Arhitektura

Modularni monolit: Express streže statični spletni vmesnik in API. Modula `auth` in `users` uporabljata krmilnike, storitve in repozitorije; modul `emails` združuje obravnavo poti in validacijo v usmerjevalniku, poslovna pravila v storitvi ter SQL v repozitoriju. Microsoft Graph je ločena integracija. PostgreSQL hrani uporabnike, seje, uvožena sporočila, stanja zahtevkov, zgodovino, omejitve prijav in šifrirane povezovalne podatke.

| Sloj | Tehnologije |
| --- | --- |
| Vmesnik | HTML, CSS, JavaScript, native Web Components |
| Strežnik | Node.js 24, Express 5, TypeScript |
| Baza | PostgreSQL 18, `pg`, SQL migracije prek `node-pg-migrate` |
| Prijava | Argon2id, `express-session`, `connect-pg-simple` |
| Outlook | Microsoft Graph; MSAL Node za OAuth in obnavljanje žetonov |
| Namestitev | Docker Compose, Caddy HTTPS, trajni PostgreSQL volumen |
| Preverjanje | Node.js test runner, assert, TypeScript, Playwright, Docker |

## Vzpostavljeno stanje in obseg

Preverjeni so lokalna vzpostavitev iz prazne baze, idempotentne migracije/sejanje, API, brskalniški potek ter gradnja produkcijske slike. Lokalna baza je med razvojem ločena od začasnih baz za preverjanje čiste vzpostavitve in vsebnika. Integracijski testi obstoječe baze uporabljajo lastne označene podatke ali transakcije z razveljavitvijo.

Povezava z resničnim Microsoftovim računom je implementirana, vendar zanjo mora upravljavec zagotoviti veljavno registracijo in soglasje. Prvi lokalni žeton je bil zavrnjen; po uporabnikovi zamenjavi so bili 12. 10. potrjeni prava sinhronizacija, delta nadaljevanje, originalni EML, priloga in brskalniški prikaz. Produkcijska Microsoftova prijava, obnovitev resničnega OAuth žetona, javni TLS in dejanska dostava pošte še niso navedeni kot uspešno preverjeni. Postopek aktivacije je dokumentiran.

## Priloženi dokumenti

1. [Vzpostavitev](vzpostavitev.md): zahteve, konfiguracija, ukazi, računi, odpravljanje napak.
2. [Funkcionalnosti](funkcionalnosti.md): obseg, pravila dostopa in predstavitveni scenarij.
3. [Stanje testiranja in zagotavljanja kakovosti](stanje-testiranja-in-zagotavljanja-kakovosti.md): obstoječe in dodane aktivnosti, stanje, pokritost, orodja, AI in preverjanje rezultatov.
4. [Microsoft Graph](microsoft-graph.md): kaj je treba zagotoviti za osebni Outlook ali Microsoft 365.
5. [Produkcija](produkcija.md): postopek namestitve, vzdrževanje in varnostno kopiranje.
6. [Uporaba AI](uporaba-ui.md): izrecna izjava o sodelovanju generativnega agenta.

## Oddaja

Oddajte povezavo do repozitorija oziroma konkretnega commita skupaj s povezavami do zgornjih dokumentov. Spremembe iz te seje je treba še pregledati in vključiti v oddani commit; agent ni izvedel objave ali oddaje v učilnico. Za predstavitev na vajah uporabite [demo scenarij](funkcionalnosti.md#predstavitev-na-vajah).

V navodilih je rok za 10 točk **12. 10. 2026**, za 7,5 točke **19. 10. 2026**, za 5 točk pa konec zimskega semestra. Ta dokument ne potrjuje dejanske oddaje in ne nadomešča presoje izvajalca predmeta.
