// Language toggle — mirrors the pattern of toggle-theme.js
// Runs inline to avoid FOUC (flash of wrong language)

(function () {
    const translations = {
        en: {
            posts: "Posts",
            postsDesc: "All the articles I've posted.",
            tags: "Tags",
            tagsDesc: "All the tags used in posts.",
            search: "Search",
            recentPosts: "Recent Posts",
            allPosts: "All Posts",
            socialLinks: "Social Links:",
            heroText:
                "Welcome to my blog, this is where I'm gonna talk mostly about my homelab and share what I do and what I learn. The homelab is built on Kubernetes, where I host various services and experiment with cloud-native tools.",
            heroLine2: "I'm",
            heroCertified: "6x AWS Certified",
            heroLine3:
                "and currently doing a master's in cybersecurity at",
            openMenu: "Open Menu",
            closeMenu: "Close Menu",
            skipToContent: "Skip to content",
        },
        fr: {
            posts: "Articles",
            postsDesc: "Tous les articles que j'ai publiés.",
            tags: "Étiquettes",
            tagsDesc: "Toutes les étiquettes utilisées dans les articles.",
            search: "Rechercher",
            recentPosts: "Articles récents",
            allPosts: "Tous les articles",
            socialLinks: "Liens sociaux :",
            heroText:
                "Bienvenue sur mon blog, c'est ici que je vais parler principalement de mon homelab et partager ce que je fais et ce que j'apprends. Le homelab tourne sur Kubernetes, où j'héberge mes applications et teste des outils cloud-native.",
            heroLine2: "Je suis",
            heroCertified: "certifié AWS 6 fois",
            heroLine3:
                "et je fais actuellement un master en cybersécurité à l'",
            openMenu: "Ouvrir le menu",
            closeMenu: "Fermer le menu",
            skipToContent: "Aller au contenu",
        },
    };

    function getLang() {
        return localStorage.getItem("lang") || "en";
    }

    function applyLang(lang) {
        const t = translations[lang] || translations["en"];

        // Update html lang attribute
        document.documentElement.setAttribute("lang", lang);

        // Swap all data-i18n elements
        document.querySelectorAll("[data-i18n]").forEach(function (el) {
            const key = el.getAttribute("data-i18n");
            if (t[key] !== undefined) {
                el.textContent = t[key];
            }
        });

        // Dual bio removal (About page deleted)

        // Sync the dropdown value if it exists
        const select = document.getElementById("lang-select");
        if (select) select.value = lang;
    }

    function setLang(lang) {
        localStorage.setItem("lang", lang);
        applyLang(lang);
    }

    // Apply on load (before paint where possible, also after Astro view transitions)
    function init() {
        applyLang(getLang());
    }

    // Expose globally so the Header dropdown can call it
    window.__setLang = setLang;
    window.__getLang = getLang;

    // Run immediately (script is is:inline so DOM may not be ready yet, but
    // the data-i18n pass happens again in astro:page-load which fires after DOM)
    document.addEventListener("DOMContentLoaded", init);
    document.addEventListener("astro:page-load", init);
    document.addEventListener("astro:after-swap", init);
})();
