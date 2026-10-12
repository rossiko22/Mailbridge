# Ključne funkcionalnosti

Ena namestitev uporablja en Outlookov predal. `GRAPH_OWNER_EMAIL` določa lokalnega lastnika predala; vloga **IT Manager** določa pravico ustvarjanja uporabnikov. To sta različni pooblastili. Lastnik je lahko IT Manager, vendar upravljavska vloga sama po sebi ne daje dostopa do osebnega predala drugega uporabnika.

Člani ekipe vidijo samo njim dodeljena sporočila. Lastnik vidi celoten predal. Če član zahtevek prenese na sodelavca ali odstrani dodelitev, izgubi dostop do njega. Zahtevek lahko zaključi samo trenutni dodeljeni uporabnik, tudi če je lastnik predala druga oseba.

| ID | Funkcionalnost | Predpogoji in pričakovani rezultat | Preverjanje |
| --- | --- | --- | --- |
| F01 | Prijava, seja, odjava | Aktiven račun, pravilen e-naslov in geslo; seja v PostgreSQL; odjava jo odstrani; napačni podatki ne razkrijejo gesla | Unit, HTTP, browser |
| F02 | Upravljanje računov in gesel | IT Manager v Settings ustvari uporabnika; uporabnik spremeni geslo; ob spremembi so vse njegove seje preklicane | HTTP, browser; operaterski CLI v deployment testu |
| F03 | Povezava z Microsoftom | OAuth z MSAL in šifriranim trajnim cachem, oziroma Microsoft 365 app-only; izbrani račun mora ustrezati predalu | Unit in simuliran HTTP; resnični OAuth še zahteva konfiguracijo |
| F04 | Sinhronizacija Inboxa | Lastnik klikne Sync now; sporočila in delta checkpoint se zapišejo transakcijsko; ni podvajanja | Unit, SQL, HTTP, browser ter resnični Outlook 12. 10. |
| F05 | Pregledi poštnih zahtevkov | All mail, Unassigned, Assigned, Assigned to me, Finished ter števci upoštevajo uporabnikov dostop | SQL, HTTP, browser |
| F06 | Iskanje, filtri, vrstni red, strani | Iskanje po pošiljatelju/zadevi/telesu; status, dodeljena oseba in zaključil; novejša/starejša; 50 zapisov in Load more | SQL, HTTP validacija, browser |
| F07 | Varno branje sporočila | Pošiljatelj, datum, izvirni HTML z oblikovanimi povezavami/tabelami; sanitizer, sandbox in CSP odstranijo aktivno vsebino; slike po izbiri, preklop v besedilo | Unit, HTTP, browser XSS regresija, pravi Outlook HTML |
| F08 | Dodeljevanje in prenos | Dodelitev sebi ali aktivnemu sodelavcu; odstranitev dodelitve; verzija prepreči prepis sočasne spremembe | SQL, HTTP, browser |
| F09 | Zaključek in ponovno odpiranje | Samo dodeljena oseba zaključi `progress`; zapisani so kdo/kdaj; ponovno odprtje `finished` vrne v `progress` | SQL, HTTP, browser |
| F10 | Odgovor na izvirno sporočilo | Dostop do zahtevka in `Mail.Send`; Graph uporabi izvirni Reply-To/pošiljatelja; lokalna sled zahteve | Graph unit, SQL deduplikacija, HTTP in browser simulacija |
| F11 | Posredovanje | Veljavni prejemniki, največ 20; pošlje se Graph forward; shranjena je zgodovina | Graph unit, HTTP in browser simulacija |
| F12 | Novo sporočilo | Lastnik sestavi zadevo, besedilo, To/Cc/Bcc; request ID preprečuje ponovno oddajo iste sprejete zahteve | Unit, HTTP in browser simulacija |
| F13 | Priloge | Seznam in prenos datotečnih/item prilog iz Outlooka; preverjanje dostopa; 25 MiB; cloud-link priloge v Outlooku | Unit, HTTP/browser simulacija ter resnična priloga 12. 10. |
| F14 | Izvoz EML | Besedilni posnetek deluje iz lokalne baze; originalni MIME z originalnimi prilogami zahteva Outlook | EML unit, HTTP/browser downloads ter resnični originalni EML 12. 10. |
| F15 | Zgodovina dela in pošiljanja | Podrobnosti prikazujejo dodelitve, zaključevanje, ponovno odpiranje ter reply/forward zahteve; nove pogovore vidi njihov avtor | SQL, HTTP, browser |
| F16 | Nastavitve povezave in zaščita | OAuth povezava oziroma preverjena menjava razvojnega žetona; lokalno stanje je jasno; varnostne glave, omejitve prijav in zaščita JSON zahtev | Unit, HTTP, browser, produkcijski smoke test |

## Stanja zahtevka

- **unassigned:** nima dodeljene osebe in nima podatkov o zaključku.
- **progress:** ima dodeljeno osebo, ni zaključen.
- **finished:** ima dodeljeno osebo, osebo zaključka in datum zaključka.

Pravila veljajo v strežniku in omejitvah baze, ne zgolj v gumbih. Spremembe povečajo `version`; zastarela zahteva vrne 409. Uvoz novih lastnosti sporočila ne ponastavi dodelitve ali statusa in ne izbriše manjkajočih lastnosti delnega delta odziva.

Pri pošiljanju je `accepted` sprejem zahteve pri Outlooku, **ne dokaz dostave**. `failed` pomeni zaznano zavrnitev; `unknown` pomeni nedoločen rezultat; `pending` lahko ostane po prekinitvi procesa. Pri zadnjih dveh je potreben pregled Sent Items pred ponovno oddajo.

## Predstavitev na vajah

### Lokalna predstavitev brez Microsofta

1. Sledite [vzpostavitvi](vzpostavitev.md) in pustite `GRAPH_AUTH_MODE=disabled`.
2. Prijavite se kot `manager@example.test`. Prikažejo se trije demo zahtevki.
3. Poiščite `VPN`; odprite vsebino in izvozite **Export text EML**.
4. Zahtevek dodelite sebi, zaključite in poiščite v Finished; filter Closed by mora kazati lastnika. Ponovno ga odprite.
5. Zahtevek dodelite `developer@example.test`.
6. V drugem profilu/zasebnem oknu se prijavite kot developer. Vidi samo dodeljeni zahtevek; lahko ga zaključi. Lastnik brez dodelitve ga ne more zaključiti namesto njega.
7. V Settings kot manager ustvarite člana ekipe. Pokažite sporočilo, da je Outlook v lokalnem načinu nepovezan.
8. Odjavite se; `/auth/me` brez seje vrne 401.

### Predstavitev resnične integracije

Po [Microsoftovi konfiguraciji](microsoft-graph.md) lastnik poveže račun, uvozi namensko testno sporočilo, prenese prilogo ter z dovoljenim testnim prejemnikom preveri odgovor, posredovanje in novo sporočilo. Na vajah ne prikazujte zasebne pošte ali skrivnosti. Avtomatski `npm run test:browser` pokaže enak uporabniški tok s sintetičnimi sporočili in brez dejanskega pošiljanja.

## Meje trenutne rešitve

Ni javne registracije, samodejnega e-poštnega obnavljanja gesla, večpredalnega/multitenant načina, samodejne sinhronizacije, webhookov, nalaganja novih prilog, rich-text urejevalnika, skupinskega ZIP izvoza ali trajnega lokalnega arhiva prilog. Operater lahko ponastavi geslo s CLI. Uporabniški vmesnik za mail pošilja navadno besedilo.

Izvoz posameznega sporočila EML je namenjen odpiranju oziroma uvozu z zunanjim poštnim programom; Ticket Mail sam nima funkcije ponovnega uvoza EML. Besedilni posnetek ne nadomešča originalnega MIME niti varnostne kopije baze. Te omejitve so izrecne, ne predstavljene kot delujoče funkcije.
