/**
 * B-70 (D-31): the choices of the settings dialog's idle time.
 *
 * A host that goes idle (`AppConfig.idleUnsubscribe`) drops its event subscriptions after this long
 * with no page open. The dialog offers the host's default, a few longer times and "never"; a time
 * the profile already holds that is none of them (edited by hand, or chosen by a newer version) is
 * offered as well, so opening and saving the dialog never changes it. Kept out of the component so
 * the rules can be tested without one.
 */

/** The fixed choices besides the default, in milliseconds; `0` is "never". */
export const IDLE_CHOICES_MS: readonly number[] = [900_000, 1_800_000, 3_600_000, 14_400_000, 0];

/** The value of the "default" entry in the select; every other entry is a number of milliseconds. */
export const IDLE_DEFAULT = 'default';

/**
 * The entries after the default one: the fixed choices, the profile's own time where it is none of
 * them (sorted in, "never" stays last), and never the default's own time twice.
 */
export function idleChoices(defaultMs: number, saved: number | undefined): number[] {
    const choices = IDLE_CHOICES_MS.filter((ms) => ms !== defaultMs);
    if (saved !== undefined && saved !== defaultMs && !choices.includes(saved)) {
        choices.push(saved);
    }
    const timed = choices.filter((ms) => ms > 0).sort((a, b) => a - b);
    return choices.includes(0) ? [...timed, 0] : timed;
}

/** What the select shows for a profile: its own time, or the default entry when it has none. */
export function idleSelectValue(saved: number | undefined, defaultMs: number): string {
    return saved === undefined || saved === defaultMs ? IDLE_DEFAULT : String(saved);
}

/** A time for the label: whole minutes where it is whole minutes, else seconds. */
export function idleDuration(ms: number): {unit: 'minutes' | 'hours' | 'seconds'; count: number} {
    if (ms >= 3_600_000 && ms % 3_600_000 === 0) {
        return {unit: 'hours', count: ms / 3_600_000};
    }
    if (ms % 60_000 === 0) {
        return {unit: 'minutes', count: ms / 60_000};
    }
    return {unit: 'seconds', count: Math.round(ms / 1000)};
}
