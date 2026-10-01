# ArmaHost Desktop 1.8.2

## Co-op starter fix
Arma refused the co-op starter made by 1.8.1 with "You cannot play/edit this mission; it is dependent on downloadable content that has been deleted. a3_characters_f".

The mission declared a required add-on by name, and Arma stops when that name doesn't match the data it has loaded. The co-op starter no longer declares any add-ons. Arma works out what the mission needs from the units it uses, all of them standard NATO infantry from the base game.

**If you created the co-op starter with 1.8.1:** open **Missions › Co-op starter** and press **Create & use** again. ArmaHost replaces its own mission folder. Then restart the server.
