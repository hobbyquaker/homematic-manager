const help_linkParamset = {
    de: {
        ACTION_TYPE: {
            helpText: 'Als Reaktion auf einen Tastendruck oder Schaltbefehl führen Aktoren eine Aktion des zugeordneten Aktionsprofils aus.',
            params: {
                INACTIVE: 'inaktiv, keine Reaktion',
                JUMP_TO_TARGET: 'springe im Profil abhängig vom aktuellen Zustand entspechend der mit JT_xx definierten Sprungziele',
                TOGGLE_TO_COUNTER: 'springe im Profil abhängig vom letzten Bit des Tastendruckzählers (0=Aus, 1=Ein)',
                TOGGLE_INV_TO_COUNTER: 'springe im Profil abhängig vom letzten Bit des Tastendruckzählers (0=Ein, 1=Aus)',
                UPDIM: 'hochdimmen um DIM_STEP und ausführen des Profils ab dem Beginn der Einschaltdauer',
                DOWNDIM: 'runterdimmen um DIM_STEP und ausführen des Profils ab dem Beginn der Einschaltdauer. Wenn der ON_MIN_LEVEL unterschritten wird, zum Beginn der Ausschaltdauer springen.',
                TOGGLEDIM: 'entgegen der letzten Richtung der Aktorveränderung den Pegel um DIM_STEP dimmen. Verhalten ist dabei wie bei UPDIM oder DOWNDIM.',
                TOGGLEDIM_TO_COUNTER: 'um DIM_STEP in Richtung des letzten Bits vom Tastendruckzähler dimmen (0=runter, 1=hoch). Verhalten ist dabei wie bei UPDIM oder DOWNDIM.',
                TOGGLEDIM_INV_TO_COUNTER: 'um DIM_STEP invers zur Richtung des letzten Bits vom Tastendruckzähler dimmen (0=hoch, 1=runter). Verhalten ist dabei wie bei UPDIM oder DOWNDIM.'
            }
        },
        LOGIC_COMBINATION: {
            helpText: 'Verknüpfungsregel, nach der virtuelle Aktorkanäle auf den physikalischen Ausgang abgebildet werden',
            params: {
                LOGIC_INACTIVE: 'Kanal wird bei der Verknüpfung ignoriert',
                LOGIC_OR: 'höherer Pegel gewinnt',
                LOGIC_AND: 'niedrigerer Pegel gewinnt',
                LOGIC_XOR: 'wenn beide != 0, dann Ergebnis = 0',
                LOGIC_NOR: 'OR mit Invertierung des Ergebnisses (200 - x)',
                LOGIC_NAND: 'AND mit Invertierung des Ergebnisses (200 - x)',
                LOGIC_ORINVERSE: 'OR mit Invertierung des Kanalwertes (200 - x)',
                LOGIC_ANDINVERSE: 'AND mit Invertierung des Kanalwertes (200 - x)',
                LOGIC_PLUS: 'x + y, max: 200',
                LOGIC_MINUS: 'x - y, min: 0',
                LOGIC_MUL: '((x * y) + 100) / 200',
                LOGIC_PLUSINVERS: 'x + (200 - y), max: 200',
                LOGIC_MINUSINVERS: 'x - (200 - y), min: 0',
                LOGIC_MULINVERS: '((x * (200 - y)) + 100) / 200',
                LOGIC_INVERSPLUS: '200 - (x + y), min: 0',
                LOGIC_INVERSMINUS: '(200 - (x - y), max: 200',
                LOGIC_INVERSMUL: '200 - (((x * y) + 100) / 200)'
            }
        },

        CT_RAMPON: {
            helpText: 'Grenzbedingung für Einschalt-Rampe',
            params: {

            }
        },
        CT_RAMPOFF: {
            helpText: 'Grenzbedingung für Ausschalt-Rampe',
            params: {

            }
        },
        CT_ONDELAY: {
            helpText: 'Grenzbedingung	für Einschalt-Verzögerung',
            params: {

            }
        },
        CT_OFFDELAY: {
            helpText: 'Grenzbedingung	für Ausschalt-Verzögerung',
            params: {

            }
        },
        CT_ON: {
            helpText: 'Grenzbedingung	für Einschalt-Verweildauer',
            params: {

            }
        },
        CT_OFF: {
            helpText: 'Grenzbedingung	für Ausschalt-Verweildauer',
            params: {

            }
        },

        JT_RAMPON: {
            helpText: 'Sprungziel für Einschalt-Rampe',
            params: {

            }
        },
        JT_RAMPOFF: {
            helpText: 'Sprungziel für Ausschalt-Rampe',
            params: {

            }
        },
        JT_ONDELAY: {
            helpText: 'Sprungziel	für Einschalt-Verzögerung',
            params: {

            }
        },
        JT_OFFDELAY: {
            helpText: 'Sprungziel	für Ausschalt-Verzögerung',
            params: {

            }
        },
        JT_ON: {
            helpText: 'Sprungziel	für Einschalt-Verweildauer',
            params: {

            }
        },
        JT_OFF: {
            helpText: 'Sprungziel	für Ausschalt-Verweildauer',
            params: {

            }
        },

        ON_MIN_LEVEL: 'Mindest-Ein-Pegel',
        ON_LEVEL: 'Pegel im Zustand Ein',
        RAMP_START_STEP: 'Reaktionssprung',
        RAMPON_TIME: 'Aufdimmzeit',
        RAMPOFF_TIME: 'Abdimmzeit',
        DIM_STEP: 'Dimschrittweite bei Dimmen',
        OFFDELAY_STEP: 'Ausschaltverzögerungs-Sprung',
        OFFDELAY_NEWTIME: 'Ausschaltverzögerungs-Blinkzeit neuer Pegel',
        OFFDELAY_OLDTIME: 'Ausschaltverzögerungs-Blinkzeit alter Pegel',

        DIM_MAX_LEVEL: 'Pegelbegrenzung beim Hochdimmen',
        DIM_MIN_LEVEL: 'Pegelbegrenzung beim Herunterdimmen',
        OFF_LEVEL: 'Pegel im Zustand Aus',
        OFF_TIME: 'Verweildauer im Zustand Aus',
        DBL_PRESS_TIME: 'Zeit für Doppelklick-Tastensperre'
    }
};
