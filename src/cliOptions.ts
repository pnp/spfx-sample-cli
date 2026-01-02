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
};
