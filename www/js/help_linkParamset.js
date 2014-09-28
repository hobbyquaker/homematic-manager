var help_linkParamset = {
    de: {
        "ACTION_TYPE": {
            "helpText": "Als Reaktion auf einen Tastendruck oder Schaltbefehl führen Aktoren eine Aktion des zugeordneten Aktionsprofils aus.",
            "params": {
                "INACTIVE": "inaktiv, keine Reaktion",
                "JUMP_TO_TARGET": "springe im Profil abhängig vom aktuellen Zustand entspechend der mit JT_xx definierten Sprungziele",
                "TOGGLE_TO_COUNTER": "springe im Profil abhängig vom letzten Bit des Tastendruckzählers (0=Aus, 1=Ein)",
                "TOGGLE_INV_TO_COUNTER": "springe im Profil abhängig vom letzten Bit des Tastendruckzählers (0=Ein, 1=Aus)",
                "UPDIM": "hochdimmen um DIM_STEP und ausführen des Profils ab dem Beginn der Einschaltdauer",
                "DOWNDIM": "runterdimmen um DIM_STEP und ausführen des Profils ab dem Beginn der Einschaltdauer. Wenn der ON_MIN_LEVEL unterschritten wird, zum Beginn der Ausschaltdauer springen.",
                "TOGGLEDIM": "entgegen der letzten Richtung der Aktorveränderung den Pegel um DIM_STEP dimmen. Verhalten ist dabei wie bei UPDIM oder DOWNDIM.",
                "TOGGLEDIM_TO_COUNTER": "um DIM_STEP in Richtung des letzten Bits vom Tastendruckzähler dimmen (0=runter, 1=hoch). Verhalten ist dabei wie bei UPDIM oder DOWNDIM.",
                "TOGGLEDIM_INV_TO_COUNTER": "um DIM_STEP invers zur Richtung des letzten Bits vom Tastendruckzähler dimmen (0=hoch, 1=runter). Verhalten ist dabei wie bei UPDIM oder DOWNDIM."
            }
        }
    }
};
