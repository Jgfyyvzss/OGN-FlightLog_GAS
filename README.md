# OGN-FlightLog_GAS

Using Google Apps Script (GAS) in a Sheet, the OGN-FlightLog pulls glider & tow plane launch and landing data from Glidernet.org.
The scripts provide a WebApp for use on the field to add pilot, passenger, tug pilot, etc details to each flight, using dropdowns or free text entry.
After flying the treasurer can simply download/copy a full set of invoices (TSV, CSV, QIF as applicable to their accounting needs) and import them to the their exisiting invoicing system. Another WebApp provides easy access to to the Export page.
The system is extensively configured from within the Sheet - select which export format you require, club name, airfield IATA/OGN code, timezone etc. Pilot, instructor and Tuggie names for dropdowns are held in the Sheet too.

This repository provides the source files for the scripts.
Scripts can either be manually pasted into your own Sheet and deployed, or a club can join the project whereupon all changes made in this source will be periodically manually pushed to their GAS. You will need to make contact to do that.

Initially the accounting packages Manager.io and Reckon have export scripts. Others can be added.
A planned addition is using API's to send the invoices to the accounting packages directly, one-click.
Another is to pull the member, instructor and tuggie list from a main club membership list.

<img width="710" height="771" alt="flighlog snip" src="https://github.com/user-attachments/assets/b1aee448-ba22-495d-b747-042103a042d1" />
Main airfield data entry screen.


<img width="429" height="351" alt="ASMB Flight Export" src="https://github.com/user-attachments/assets/ddfa1c08-5e71-4b89-a849-aff2161a85af" />
Invoice Export screen.
