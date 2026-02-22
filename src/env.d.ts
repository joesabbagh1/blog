/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface Window {
    __setLang: (lang: string) => void;
    __getLang: () => string;
}
