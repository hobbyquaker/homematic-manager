# Systemd Service

This is a systemd service unit file. It was created and tested on Debian 8 Jessie.

How to install and use:
* Create a dedicated system user: `adduser --system --shell /bin/sh hm-man`
* chown the homematic-manager files to the new user (hm-man)
* Edit `homematic-manager.service` to fit your install location, if it is not `/opt/homematic-manager`
* Optional: if you chaned the user name from hm-man to something else, you need to edit the .service file to fit this username
* Copy it to `/lib/systemd/system/homematic-manager.service`
* Reload: `systemd daemon-reload`
* Enable: `systemd enable homematic-manager`

Use it the usual way:
* `systemd start homematic-manager`
* `systemd stop homematic-manager`
* `systemd status homematic-manager`

