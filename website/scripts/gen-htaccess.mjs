// Vygeneruje out/.htaccess pro statický export na Apache hostingu (Hosting90 / Webglobe).
// Spouští se po `STATIC_EXPORT=1 next build` (npm run build:ftp).
// Přesměrování a bezpečnostní hlavičky bere z next.config.mjs, aby byly na Vercelu i na FTP stejné.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { legacy, legacyDirs, securityHeaders } from "../next.config.mjs";

if (!existsSync("out")) {
  console.error("[htaccess] složka out/ neexistuje — nejdřív spusť STATIC_EXPORT=1 next build");
  process.exit(1);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rules = legacy
  .map(([from, to]) => `RewriteRule ^${esc(from.replace(/^\//, ""))}/?$ ${to === "/" ? "/" : to + (to.includes(".") ? "" : "/")} [R=301,L,NC]`)
  .join("\n");
// přejmenované složky: celý obsah (obrázky…) na stejné jméno souboru v nové složce
const dirRules = legacyDirs.map(([from, to]) => `RewriteRule ^${esc(from.replace(/^\//, ""))}/(.+)$ ${to}/$1 [R=301,L,NC]`).join("\n");

const headers = securityHeaders
  .filter((h) => h.key !== "Strict-Transport-Security")
  .map((h) => `  Header always set ${h.key} "${h.value}"`)
  .join("\n");
const hsts = securityHeaders.find((h) => h.key === "Strict-Transport-Security");

const htaccess = `# Vygenerováno scripts/gen-htaccess.mjs — neupravovat ručně
DirectoryIndex index.html index.php
Options -Indexes
AddDefaultCharset utf-8

<IfModule mod_mime.c>
  AddType application/manifest+json .webmanifest
  AddType application/wasm .wasm
  AddType font/woff2 .woff2
  AddType application/javascript .mjs
  AddType application/gzip .tgz
  AddType text/x-component .txt
</IfModule>
# .txt je text/x-component kvůli RSC datům Next.js; soubory pro roboty a AI musí být text/plain
<FilesMatch "^(robots|llms|llms-full|humans|security)\\.txt$">
  ForceType text/plain
</FilesMatch>
<Files "opengraph-image">
  ForceType image/png
</Files>

ErrorDocument 404 /404/index.html

<IfModule mod_rewrite.c>
  RewriteEngine On

  # mnastrojarna.cz → www.mnastrojarna.cz (zachová http/https)
  RewriteCond %{HTTP_HOST} ^mnastrojarna\\.cz$ [NC]
  RewriteCond %{HTTPS} =on
  RewriteRule ^(.*)$ https://www.mnastrojarna.cz/$1 [R=301,L]
  RewriteCond %{HTTP_HOST} ^mnastrojarna\\.cz$ [NC]
  RewriteRule ^(.*)$ http://www.mnastrojarna.cz/$1 [R=301,L]

  # Úložiště sdílených odkazů CADu (PHP, out/cad/share/index.php) – nikdy nepřepisovat ani nepřesměrovávat
  RewriteRule ^cad/share/ - [L]

  # Staré adresy původního webu → nové stránky
${rules}
${dirRules}

  # Chybějící lomítko na konci (statický export používá složka/index.html)
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME}/index.html -f
  RewriteRule ^(.*[^/])$ /$1/ [R=301,L]

  # Neexistující stránky v EN/DE → 404 v daném jazyce
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^(en|de)/ /$1/404/index.html [L]
</IfModule>

<IfModule mod_headers.c>
${headers}
  # HSTS jen přes HTTPS (na HTTP by prohlížeč hlavičku stejně ignoroval)
  Header always set ${hsts.key} "${hsts.value}" env=HTTPS
  <FilesMatch "\\.(js|css|woff2|wasm|png|jpe?g|webp|avif|svg|ico)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "\\.(html|txt|xml|webmanifest)$">
    Header set Cache-Control "public, max-age=0, must-revalidate"
  </FilesMatch>
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/plain text/xml application/javascript application/json application/manifest+json image/svg+xml application/wasm
</IfModule>
`;

writeFileSync("out/.htaccess", htaccess);
console.log(`[htaccess] out/.htaccess zapsán (${legacy.length + legacyDirs.length} přesměrování)`);

// Úložiště krátkých sdílených odkazů CADu: PHP skript + jeho .htaccess / .user.ini (statický export kopíruje public/,
// pro jistotu se soubory doplní, kdyby chyběly – např. tečkové soubory).
const SHARE = ["index.php", ".htaccess", ".user.ini"];
mkdirSync("out/cad/share", { recursive: true });
for (const f of SHARE) if (!existsSync(`out/cad/share/${f}`) && existsSync(`public/cad/share/${f}`)) copyFileSync(`public/cad/share/${f}`, `out/cad/share/${f}`);
const missing = SHARE.filter((f) => !existsSync(`out/cad/share/${f}`));
if (missing.length) console.warn(`[htaccess] POZOR: v out/cad/share chybí ${missing.join(", ")} – krátké sdílené odkazy CADu nebudou fungovat`);
else console.log("[htaccess] out/cad/share/ (index.php, .htaccess, .user.ini) – úložiště krátkých sdílených odkazů CADu; po nahrání ověřte https://www.mnastrojarna.cz/cad/share/?ping");

// CLI mncad (scripts/cad-cli-build.mjs, prebuild): verzované složky cad/cli/<verze>/ jsou neměnné (rok v mezipaměti),
// ukazatel latest.json a README.txt se nesmí ukládat do mezipaměti; .txt jako text/plain (ne RSC text/x-component).
if (existsSync("out/cad/cli")) {
  writeFileSync(
    "out/cad/cli/.htaccess",
    `# Vygenerováno scripts/gen-htaccess.mjs — CLI mncad (verzované svazky cad/cli/<verze>/)
<IfModule mod_mime.c>
  AddType application/javascript .mjs
  AddType application/gzip .tgz
  AddType application/wasm .wasm
  AddType application/json .json
  AddType text/plain .txt
</IfModule>
<Files "SHA256SUMS">
  ForceType text/plain
</Files>
<IfModule mod_headers.c>
  <FilesMatch "\\.(mjs|tgz|wasm|ttf)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "^(latest\\.json|README\\.txt)$">
    Header set Cache-Control "no-cache, max-age=0, must-revalidate"
  </FilesMatch>
</IfModule>
`,
  );
  console.log("[htaccess] out/cad/cli/.htaccess zapsán (MIME .mjs/.tgz, bez mezipaměti latest.json a README.txt)");
} else console.warn("[htaccess] POZOR: out/cad/cli chybí – CLI mncad se nepublikuje (npm run cad:cli)");
