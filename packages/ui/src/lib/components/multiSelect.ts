/** One entry of {@link MultiSelect}. */
export interface MultiSelectOption {
    readonly value: string;
    readonly label: string;
    readonly disabled?: boolean;
}

/** The entries whose label contains the filter text, case-insensitively. */
export function filterOptions(options: readonly MultiSelectOption[], filter: string): MultiSelectOption[] {
    const needle = filter.trim().toLowerCase();
    if (needle === '') {
        return [...options];
    }
    return options.filter((option) => option.label.toLowerCase().includes(needle));
}
