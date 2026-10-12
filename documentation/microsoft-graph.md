# Povezava z resničnim Outlookom

Ticket Mail uporablja **Microsoft Graph**, ne IMAP/SMTP in ne gesla Microsoftovega računa. Lokalna prijava in avtorizacija predala sta ločeni. Najprej ustvarite uporabnika aplikacije; nato lastnik v Settings poveže Microsoftov predal oziroma upravljavec nastavi aplikacijske poverilnice.

## Izbira načina

| Predal / namen | `GRAPH_AUTH_MODE` | Obnavljanje dostopa |
| --- | --- | --- |
| Osebni Outlook.com / Hotmail | `oauth` | MSAL samodejno uporablja shranjeni predpomnilnik in obnovitvene žetone; ob preklicu soglasja je potrebna ponovna povezava |
| Microsoft 365 lastni uporabniški predal | `oauth` | Enak postopek, organizacijski tenant |
| Microsoft 365 skupni ali servisni predal | `application` | Strežnik pridobiva aplikacijske žetone s client credentials; pred iztekom je treba rotirati client secret |
| Kratek lokalni preizkus z Graph Explorerjem | `access_token` | Ročna menjava kratkoživega žetona; **ni dovoljen produkcijski način** |
| Lokalna demonstracija brez Microsofta | `disabled` | Branje in delo z demo zahtevki; ni sinhronizacije ali pošiljanja |

Implementirani OAuth uporablja `/me` in zato pričakuje **lastni predal prijavljenega Microsoftovega uporabnika**. Za skupni Microsoft 365 predal uporabite `application`; delegirani dostop do poljubnega skupnega predala ni implementiran.

## Kaj morate zagotoviti

Vrednosti vnesite v lokalno `.env` ali v strežniško `.env.production`/upravitelja skrivnosti. **Gesel, client secreta, sejnih skrivnosti in žetonov ne pošiljajte v klepet ali v Git.**

| Podatek | Kje ga dobite | Primer brez skrivnosti |
| --- | --- | --- |
| Delujoč Microsoftov predal | Outlook.com oziroma skrbnik Microsoft 365 | `support@outlook.com` |
| Lokalni lastnik predala | Račun, ustvarjen v Ticket Mail | `administrator@your-domain.example` |
| Application (client) ID | Microsoft Entra → App registrations → vaša aplikacija → Overview | UUID registracije |
| Tenant | Osebni računi: `consumers`; organizacija: Directory (tenant) ID | `consumers` ali UUID |
| Client secret **value** | App registrations → Certificates & secrets → New client secret | Vrednost, prikazana ob nastanku; ne Secret ID |
| Točen callback URL | Vaša domena + pot aplikacije; registrirate kot Web redirect URI | `https://tickets.example.com/emails/connection/callback` |
| Microsoftova dovoljenja/soglasje | API permissions in Microsoftova prijava oziroma tenant administrator | Spodaj po načinih |
| Veljavna domena in HTTPS | DNS in produkcijski strežnik | `PUBLIC_ORIGIN=https://tickets.example.com` |

Za osebni račun mora registracija podpirati osebne Microsoftove račune. Dostop do ustvarjanja registracije oziroma ustreznega Entra okolja morate zagotoviti sami; obstoj Outlook.com naslova sam po sebi ne zagotavlja, da imate že pripravljeno registracijo aplikacije.

## Osebni Outlook – produkcijski OAuth

1. V [Microsoft Entra admin center](https://entra.microsoft.com/) ustvarite **App registration**. Podprti tipi računov morajo vključevati osebne Microsoftove račune (npr. organizacijski imeniki in osebni računi). Za izključno organizacijsko namestitev izberite ustrezen organizacijski tip.
2. V **Authentication → Add a platform → Web** dodajte točen callback. Za lokalni razvoj: `http://localhost:3000/emails/connection/callback`. Za produkcijo: `https://VAŠA-DOMENA/emails/connection/callback`. Ne uporabite tipa SPA; skrivnost ostaja na strežniku.
3. Dodajte Microsoft Graph **delegated** dovoljenja `User.Read`, `Mail.Read`, `Mail.Send`. Aplikacija pri prijavi zahteva tudi `offline_access`; ta omogoča obnavljanje dostopa. Organizacijska politika lahko zahteva skrbniško soglasje.
4. Ustvarite client secret, shranite njegovo **vrednost** in datum izteka.
5. Nastavite:

   ```dotenv
   GRAPH_AUTH_MODE=oauth
   GRAPH_TENANT_ID=consumers
   GRAPH_CLIENT_ID=APPLICATION_CLIENT_ID
   GRAPH_CLIENT_SECRET=CLIENT_SECRET_VALUE
   GRAPH_MAILBOX=your-real-address@outlook.com
   GRAPH_OWNER_EMAIL=administrator@your-domain.example
   GRAPH_REDIRECT_URI=https://tickets.your-domain.example/emails/connection/callback
   PUBLIC_ORIGIN=https://tickets.your-domain.example
   GRAPH_ACCESS_TOKEN=
   ```

6. Uporabnik `GRAPH_OWNER_EMAIL` mora že obstajati in biti aktiven. Za prvo produkcijsko namestitev uporabite [admin:create](produkcija.md).
7. Po migracijah in zagonu se prijavite v Ticket Mail kot lastnik. V **Settings → Connect Microsoft Outlook** izberite predvideni Microsoftov račun in odobrite dovoljenja.
8. Strežnik pred shranitvijo preveri, da `mail` ali `userPrincipalName` Microsoftovega `/me` ustreza `GRAPH_MAILBOX`. Napačen račun ne zamenja obstoječe povezave. Če imate alias, uporabite naslov, ki ga vrne `/me`, ne poljubnega dodatnega aliasa.
9. V Settings mora biti prikazano, da je Microsoft povezan. Kliknite **Sync now**. Uvožena sporočila se hranijo v PostgreSQL.

OAuth uporablja naključno stanje, PKCE S256 in desetminutno veljavnost začetega povezovanja. MSAL hrani avtorizacijske podatke v šifriranem predpomnilniku v PostgreSQL; ključa `TOKEN_ENCRYPTION_KEY` ne spreminjajte brez načrta ponovne povezave. PostgreSQL zaklep usklajuje obnovitve med procesi. Microsoftove žetone je mogoče preklicati; nobena aplikacija ne more zagotoviti trajnega dostopa po preklicu soglasja ali računa. Ob zavrnitvi ponovno povežite predal v Settings.

Za Microsoft 365 uporabniški OAuth zamenjajte `consumers` z vašim tenant UUID. Lokalna in produkcijska callback URL morata biti vsaka izrecno registrirana.

## Microsoft 365 – aplikacijski/servisni dostop

Ta način ni namenjen osebnim Outlook.com računom.

1. Organizacijski administrator ustvari praviloma single-tenant registracijo.
2. Doda Microsoft Graph **Application permissions** `Mail.Read` in `Mail.Send` ter uredi zahtevano skrbniško soglasje.
3. Omeji dostop aplikacije na predvideni predal z ustreznim Exchange Online RBAC oziroma podprto politiko dostopa. Sam `GRAPH_MAILBOX` **ne omeji** Microsoftovih dovoljenj. Pri RBAC naj skrbnik preveri tudi širša, ločeno dodeljena Entra dovoljenja, saj se pravice lahko seštevajo.
4. Nastavi:

   ```dotenv
   GRAPH_AUTH_MODE=application
   GRAPH_TENANT_ID=ORGANIZATION_TENANT_UUID
   GRAPH_CLIENT_ID=APPLICATION_CLIENT_ID
   GRAPH_CLIENT_SECRET=CLIENT_SECRET_VALUE
   GRAPH_MAILBOX=support@organization.example
   GRAPH_OWNER_EMAIL=administrator@organization.example
   GRAPH_ACCESS_TOKEN=
   ```

5. Ponovno zažene aplikacijo. Microsoftova interaktivna prijava v Settings v tem načinu ni potrebna; tam je navedeno, da se poverilnice urejajo na strežniku.
6. Lastnik sinhronizira predal in izvede spodnji sprejemni pregled. Pred iztekom zamenja client secret ter ponovno zažene aplikacijo.

V produkciji je `GRAPH_OWNER_EMAIL` obvezen tudi za aplikacijski dostop. Lastnik vidi celoten predal, ga sinhronizira in začenja nove pogovore. Drugi uporabniki vidijo njim dodeljene zahtevke. V starem razvojnem aplikacijskem načinu brez lastnika imajo vsi aktivni uporabniki upravljavski dostop; za novo namestitev lastnika vedno nastavite.

## Začasni razvojni način Graph Explorer

Za kratek razvojni preizkus uporabite [Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer), prijavite se v ciljni račun in odobrite delegated `User.Read`, `Mail.Read`, `Mail.Send`.

```dotenv
NODE_ENV=development
GRAPH_AUTH_MODE=access_token
GRAPH_ACCESS_TOKEN=TOKEN_WITHOUT_BEARER_PREFIX
GRAPH_MAILBOX=your-real-address@outlook.com
GRAPH_OWNER_EMAIL=manager@example.test
```

Lastnik lahko v Settings vnese nov žeton. Pred shranitvijo se preverita račun in bralni dostop; žeton je šifriran, nikoli prikazan nazaj, uporabi se brez ponovnega zagona. Preverjanje shranitve samo po sebi ne dokazuje dovoljenja za dejansko pošiljanje. Shranjeni žeton ima prednost pred `.env`; novega shranite v Settings. Ta način nima avtomatskega obnavljanja in ga produkcijska konfiguracija zavrne.

## Preverjanje prave povezave

Po gradnji:

```sh
npm run outlook:check
```

V produkcijskem Compose:

```sh
docker compose --env-file .env.production -f compose.production.yaml exec app npm run outlook:check
```

Preverjanje uporabi shranjeni checkpoint (ali začetni Inbox, če ga še ni), prebere stran in po potrebi preveri tudi naslednji continuation URL. Izpiše le število sprememb, checkpointa ne spremeni ter ne uvozi ali pošlje pošte. Za OAuth najprej povežite račun v Settings.

Pred predajo prave namestitve opravite sprejemni preizkus z lastnim testnim pošiljateljem/prejemnikom:

1. Pošljite testno sporočilo v povezani predal, kliknite Sync now in preverite prikaz.
2. Sinhronizirajte znova: sporočilo se ne sme podvojiti.
3. Dodelite zahtevek drugemu uporabniku in preverite omejitev vidnosti.
4. Izrecno pošljite odgovor, posredovano in novo sporočilo na dogovorjeni testni naslov; potrdite **dejanski prejem** ter Sent Items. HTTP 202 pomeni sprejem zahteve pri Microsoftu, ne potrjene dostave.
5. Preverite znano priponko in originalni EML.
6. Pri OAuth po poteku dostopnega žetona preverite nadaljnjo sinhronizacijo brez ročnega kopiranja žetona. Preverite tudi ponovno povezovanje po preklicu soglasja.

Avtomatski testi tega repozitorija ne izvajajo teh korakov proti resnični pošti. Prvi pregled **11. 10. 2026** je zavrnil stari žeton. Po uporabnikovi zamenjavi je **12. 10. 2026** uspela resnična sinhronizacija do konca (503 različnih shranjenih sporočil v trenutku preverjanja), ponovni delta klic, originalni EML ter prenos priloge. Preverjen je bil tudi brskalniški gumb Sync now in prikaz prave pošte. Prava pošta ni bila poslana; produkcijski OAuth in dostava zato ostajata ločena sprejemna preizkusa.

## Obseg in napake

- Ročna inkrementalna sinhronizacija Inboxa; do 20 strani po največ približno 50 sporočil na klik, nato nadaljujte z novim klikom. Ni urnika ali webhookov.
- Premik/izbris v Outlooku ne izbriše že uvoženega lokalnega zapisa. Originalni EML in priloge potrebujejo še obstoječi izvirnik v Outlooku.
- Besedilni EML je lokalni posnetek; ne vključuje originalnih prilog in vseh Microsoftovih glav. Originalni EML se prenese neposredno iz Microsofta.
- Posamezen prenos je omejen na **25 MiB**. Cloud-link priloge odprite v Outlooku.
- Nova sporočila so navadno besedilo s To/Cc/Bcc, največ 20 prejemnikov skupaj; nalaganje novih prilog in bogato oblikovanje nista vključena.
- Pri starejšem `Invalid Microsoft synchronization cursor.` posodobite aplikacijo: Microsoft uporablja tudi veljavno obliko `mailFolders('inbox')`. Popravljena različica ohrani celoten opaque cursor in prepozna obe dovoljeni obliki poti; baze ali checkpointa ni treba brisati.
- `409` pri sinhronizaciji: že teče druga sinhronizacija. `410`: stari delta checkpoint je odstranjen; znova kliknite Sync. `429`: počakajte pred ponovitvijo.
- `pending` ali `unknown` pri pošiljanju: rezultat ni potrjen. **Najprej preverite Sent Items**, da ne podvojite sporočila. Strežnik pošiljanja ne ponavlja samodejno.
- Napaka OAuth: preverite tip registracije, tenant, callback, vrednost/veljavnost client secreta, izbrani račun in dovoljenja. Napaka pri prenosu: preverite `Mail.Read`, obstoj izvirnika in omejitev velikosti.

## Primarni viri

Preverjeno glede na Microsoftovo dokumentacijo 11. 10. 2026:

- [OAuth authorization code + PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [MSAL Node – pridobivanje žetonov](https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests)
- [MSAL Node – trajni predpomnilnik](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching)
- [Microsoftova veljavnost in preklic obnovitvenih žetonov](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)
- [Exchange Online RBAC za aplikacije](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)
- [Delta sporočil in uporaba celotnega continuation URL](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)
- [Pošiljanje sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)
- [Seznam prilog](https://learn.microsoft.com/en-us/graph/api/message-list-attachments?view=graph-rest-1.0) in [prenos priloge](https://learn.microsoft.com/en-us/graph/api/attachment-get?view=graph-rest-1.0)
- [Pridobitev sporočila oziroma MIME](https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0)

## Oblikovan prikaz e-pošte

Seznam in iskanje še vedno uporabljata lokalno besedilno kopijo. Ob prvem odprtju sporočila aplikacija prebere izvirni `body` z `Prefer: outlook.body-content-type="html"`; zato že uvoženih sporočil ni treba ponovno sinhronizirati. Prikaz ohrani dovoljene tabele, povezave, gumbe in slogovne lastnosti. HTML se sanitizira s `sanitize-html` ter prikaže v ločenem iframe z onemogočenimi skriptami, obrazci in zunanjim CSS. Vse avtorizacijske omejitve zahtevka veljajo tudi za HTML endpoint.

**Show images** omogoči HTTPS slike samo za trenutno odprto sporočilo; to lahko pošiljatelju razkrije odprtje. Privzeto ni zunanjih slik ali sledilnih zahtev. Vdelane `cid:` slike še niso razrešene; ostane nadomestno besedilo, originalni EML pa je na voljo prek **Download**. Ne podpira vsake Outlookove/VML/CSS posebnosti. **Plain text** pokaže lokalno kopijo. Če Outlook ni dosegljiv, se prikaže shranjeno besedilo z obvestilom.

Preverjeno 12. 10. 2026: štiri resnične HTML vsebine iz uporabnikovega predala ter brskalniški prikaz enega OpenAI sporočila (tabele/povezave, brez skript ali samodejnega nalaganja slik). Zasebna vsebina ni vključena v testne fixture ali posnetke.

Vira: [Microsoft Get message](https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0), [sanitize-html dokumentacija](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html).

Uspešno pridobljeno izvirno telo se od migracije 007 shrani v `email_bodies` in ob naslednjem odpiranju ponovno sanitizira. Zato že pridobljen HTML ostane berljiv tudi po poteku žetona. Sporočila, za katera je bila doslej shranjena samo besedilna kopija, potrebujejo veljaven dostop za prvo pridobitev izvirnega HTML. Ob napaki se ohranijo berljive oznake povezav namesto dolgih sledilnih URL-jev; prikazana je dejanska napaka Microsoftove povezave in gumb **Retry Outlook**. To ni rekonstrukcija izvirnega HTML.
