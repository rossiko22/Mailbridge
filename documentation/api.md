# API in poslovna pravila

API in vmesnik imata isti izvor. Prijava uporablja HttpOnly sejni piškotek `session`; bearer token za Ticket Mail API ni podprt. Microsoftovi žetoni nikoli niso odgovor API-ja. Vse spremembe zahtevajo `Content-Type: application/json` in istoizvorno zahtevo. Napake imajo obliko `{"message":"opis"}`.

| Metoda in pot | Namen / podatki |
| --- | --- |
| `GET /health` | Preverjanje baze, brez prijave |
| `POST /auth/login` | `{email,password}` → `{user}`; rotira ID seje |
| `GET /auth/me` | Trenutni varen profil brez password hash |
| `POST /auth/logout` | `{}`; uniči sejo in izbriše piškotek |
| `POST /auth/password` | `{currentPassword,newPassword}`; najmanj 12 znakov; prekliče vse uporabnikove seje |
| `POST /users` | IT Manager; `{email,password,role,avatarPath}`; vloga 1 ali 2; 201 ali 409 za obstoječ e-naslov |
| `GET /emails/meta` | Uporabniki za dodelitev, dostopu prilagojeni števci, `outlookConfigured`, `canManage`, `currentUser` |
| `GET /emails` | Seznam do 50 sporočil, `{emails,hasMore}` |
| `GET /emails/:id` | Dostopno sporočilo, telo, aktivnost in reply/forward zgodovina; Microsoftov ID ni vrnjen |
| `PATCH /emails/:id/ticket` | `{action,version,assignee?}`; `assign`, `finish`, `reopen` |
| `POST /emails/sync` | Lastnik; `{}`; obdela eno Graph stran in checkpoint |
| `POST /emails/:id/send` | `{action,requestId,comment,recipients}`; `reply` ali `forward`; 202 ob sprejemu |
| `POST /emails/compose` | Lastnik; `{requestId,subject,body,to,cc?,bcc?}`; UUID, največ 250 znakov zadeve, 20.000 telesa, 20 naslovnikov |
| `GET /emails/outgoing` | Zadnjih 50 novih sporočil trenutnega avtorja; ne razkriva Bcc sodelavcem |
| `GET /emails/:id/body` | Avtoriziran, sanitiziran dokument za iframe iz lokalno shranjenega izvirnika ali Microsofta; pri nedosegljivem izvirniku berljiva besedilna kopija z opozorilom; opcija `?images=true` dovoli HTTPS slike; privzeto brez zunanjih slik |
| `GET /emails/:id/export` | Prenos lokalnega besedilnega EML |
| `GET /emails/:id/export?original=true` | Prenos originalnega MIME iz Outlooka |
| `GET /emails/:id/attachments` | Seznam prilog iz Microsofta |
| `GET /emails/:id/attachments/:attachmentId` | Prenos kot attachment/octet-stream; ID priloge URL-enkodirajte |
| `GET /emails/connection` | Lastnik; varen opis povezave brez skrivnosti |
| `PUT /emails/connection/token` | Lastnik, razvojni access_token način; `{token}` |
| `GET /emails/connection/authorize` | Lastnik, OAuth; začne Microsoftovo prijavo |
| `GET /emails/connection/callback` | OAuth callback; preveri enkratno stanje seje in veljavnost |

## Filtri seznama

`offset` (0–1.000.000), `status` (`all`, `unassigned`, `progress`, `finished`), `view` (`all`, `assigned`, `mine`), `sort` (`newest`, `oldest`), `search` (največ 200 znakov), `assignee` (UUID), `closedBy` (UUID). Filtri ne morejo razširiti uporabnikovega dovoljenega nabora.

Za dodelitev vedno pošljite `assignee`: UUID aktivnega uporabnika ali `null`. `version` je trenutna nenegativna verzija iz podrobnosti. Ne ugibajte naslednje verzije po napaki; ponovno preberite zahtevek. Zaključek zahteva trenutno dodelitev prijavljenemu uporabniku in stanje `progress`.

Pri reply mora biti `recipients=[]`, ker Graph uporabi izvirno sporočilo. Pri forward mora biti najmanj en naslovnik. `requestId` je nov UUID posamezne oddaje. Ponovitev identične že sprejete oddaje ne pošlje dodatnega sporočila; isti ID z drugačnimi podatki ali nedokončanim stanjem vrne 409. Samodejnih ponovitev po časovni omejitvi ni.

## Statusi

- **400:** neveljavni podatki ali dejanje.
- **401:** ni veljavne seje oziroma račun ni več aktiven.
- **403:** prijavljen uporabnik nima zahtevanega pooblastila.
- **404:** sporočilo ne obstaja ali ni dostopno uporabniku; enak odziv ne razkriva tuje pošte.
- **409:** konflikt verzije, vzporedna sinhronizacija, že obstoječ uporabnik ali že oddana zahteva.
- **410:** Microsoftov delta checkpoint je potekel; odstranjen je bil in potreben je nov Sync.
- **413:** prevelika zahteva/prenos; JSON zahteve imajo omejitev 64 KiB, prenosi 25 MiB.
- **415:** sprememba ni ustrezna istoizvorna JSON zahteva.
- **429:** lokalna omejitev prijav ali Microsoftova omejitev.
- **502/503:** Microsoftova napaka, nedoločen rezultat pošiljanja ali nepovezan predal.

API je notranji API spletne aplikacije. Za neodvisne odjemalce ni objavljena OpenAPI pogodba, API ključ ali CORS dostop z drugih domen.
