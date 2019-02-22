#!/bin/bash

scp root@homematic-raspi:/www/config/devdescr/DEVDB.tcl /Users/basti/WebstormProjects/occu/WebUI/www/config/devdescr/
scp -r root@homematic-raspi:/www/config/img/* /Users/basti/WebstormProjects/occu/WebUI/www/config/img/

node convert_imgpaths.js
