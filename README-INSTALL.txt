REAL ESTATE ERP - INSTALLING ON ANOTHER PC
============================================

ON THE CURRENT PC (once, each time you want to take the latest data)
  1. Double-click  package.bat
     -> creates  dist\RealEstateERP-<date>.zip
        (the program + a fresh copy of the database)
  2. Copy that zip to the other PC (USB stick, etc.).
     It contains the client's accounts and users: keep it private.

ON THE OTHER PC (Windows 10 or 11)
  1. Unzip it anywhere, e.g.  C:\RealEstateERP
  2. Double-click  setup.bat   (takes 5-10 minutes the first time)
       - If Python, Node.js or PostgreSQL is missing it offers to install it
         (answer Y). Needs internet.
       - It asks for the PostgreSQL "postgres" password: the one chosen when
         PostgreSQL was installed (or the one you type if setup installs it).
       - It ends with "Setup complete." and a desktop shortcut
         "Real Estate ERP".
  3. Double-click  start.bat   (or the desktop shortcut)
       - The browser opens at  http://localhost:3000
       - Two minimized windows, "ERP backend" and "ERP frontend", appear in
         the taskbar. Leave them open while you use the system.
  4. Sign in with the same user names and passwords as on the current PC.

EVERY DAY
  start.bat  to open the system,  stop.bat  to close it.

IF SOMETHING GOES WRONG
  - Every message says what to do next. setup.bat can be run again safely.
  - setup.bat writes a log in the  logs  folder; send it along when asking
    for help.
  - "Port 3000 is already used": start.bat switches to port 3100 by itself;
    for port 8000, close the program named in the message or run stop.bat.
  - To replace the database on the other PC with a newer package:
    unzip the new package, then run   setup.bat -Force
    (this DELETES the data on that PC and restores the package's copy).
  - PostgreSQL on a port other than 5432:   setup.bat -PgPort 5433

WHAT IS NEEDED (setup.bat checks all of it)
  Python 3.11 - 3.13,  Node.js 18.18 or newer,  PostgreSQL 14 or newer.
