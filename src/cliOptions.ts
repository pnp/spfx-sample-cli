export type Mode = "extract" | "repo";
export type Method = "auto" | "git" | "api";

export type CliOptions = {
    ref: string;
    dest?: string;
    force?: boolean;
    repo?: string;
    owner?: string;
    verbose?: boolean;
    mode?: Mode;
    method?: Method;

    /** New project/package name to apply after download */
    rename?: string;

    /**
     * If passed with a value: use that GUID.
     * If passed without a value: generate a GUID.
     * If omitted: do nothing.
     */
    newid?: string | boolean;
};
