# Izjava o uporabi generativne umetne inteligence

Pri dopolnitvi projekta, testov in dokumentacije **11.–12. 10. 2026 je bil uporabljen OpenAI Codex**, generativni programski agent. Uporaba AI ni omejena na popravljanje jezika: agent je sodeloval pri pregledu, načrtovanju popravkov, implementaciji, pripravi testov, izvajanju orodij in pisanju dokumentacije.

## Obseg sodelovanja

- Pregled obstoječega strežnika, uporabniškega vmesnika, SQL migracij in navodil.
- Popravki validacije, prijave, dovoljenj, delnih Graph posodobitev ter resnično opažene napake OData cursorja.
- Dopolnitev sestavljanja pošte, prenosov, EML, lokalnega demo načina, OAuth/MSAL, upravljanja gesel in produkcijskih nastavitev.
- Priprava/dopolnitev enotskih, integracijskih, brskalniških, čistih namestitvenih in vsebniških testov.
- Priprava Docker/Compose/Caddy, CI in operativnih navodil.
- Pisanje dokumentov za izbor projekta, vzpostavitev, funkcionalnosti in stanje kakovosti.

V tej seji **ni bilo delegiranja podagentom**. Dokumentacija ne pripisuje avtorstva starejših delov repozitorija izključno človeku ali AI, ker za to ni popolne evidence.

## Kako so bili rezultati preverjeni

Agent je dejansko izvajal TypeScript kompilacijo, Node.js teste, transakcijske teste na PostgreSQL, HTTP scenarije, Playwright v Chromiumu, migracije in seed v prazni začasni bazi, Docker gradnjo, produkcijski smoke test ter pg_dump/pg_restore. Microsoftovi protokoli in dovoljenja so bili primerjani s primarnimi Microsoftovimi viri, navedenimi v [navodilih za Outlook](microsoft-graph.md).

Ko je uporabnik prijavil `Invalid Microsoft synchronization cursor.`, je agent napako reproduciral s shranjenim resničnim cursorjem, primerjal obliko URL-ja in dodal regresijske teste. Uporabnik je zagotovil veljaven dostopni žeton v konfiguraciji; agent je nato preveril resnično branje, uvoz in delta nadaljevanje. Dejanska pošta ni bila poslana brez posebej dogovorjenega prejemnika.

Pri simuliranih testih so uporabljeni sintetični podatki in nadomestki Microsoftovih odzivov. Ti testi ne pomenijo, da je bila potrjena resnična dostava pošte, Microsoftovo produkcijsko soglasje ali javna namestitev. Podrobnosti, uspehi in omejitve so zapisani v [stanju kakovosti](stanje-testiranja-in-zagotavljanja-kakovosti.md).

## Odgovornost pri oddaji

Avtor projekta naj pred oddajo pregleda diff, kodo in dokumentacijo, razume uporabljene rešitve, preveri navodila na svojem okolju ter priloži to izjavo. Agentova lastna avtomatska preverjanja niso neodvisen človeški pregled. Projekt ni bil samodejno oddan v učilnico, objavljen na domeno ali potisnjen v oddaljeni repozitorij.

Besedilo za navedbo v oddaji:

> Pri pripravi projekta sem uporabil OpenAI Codex za pregled in dopolnitev kode, testov ter dokumentacije. Rezultati so bili preverjeni s TypeScriptom, avtomatskimi testi, dejanskim PostgreSQL/HTTP/brskalniškim potekom in Docker namestitvenimi testi. Obseg uporabe in omejitve preverjanja so opisani v dokumentih »Uporaba generativne umetne inteligence« in »Stanje testiranja in zagotavljanja kakovosti«.

Navedeno besedilo ustrezno dopolnite s svojim dejansko opravljenim pregledom; ne navajajte ročnega preverjanja, ki ga niste izvedli.
