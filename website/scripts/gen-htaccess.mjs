// Vygeneruje out/.htaccess pro statický export na Apache hostingu (Hosting90 / Webglobe).
// Spouští se po `STATIC_EXPORT=1 next build` (npm run build:ftp).
// Přesměrování a bezpečnostní hlavičky bere z next.config.mjs, aby byly na Vercelu i na FTP stejné.
import { writeFileSync, existsSync } from "node:fs";
import { legacy, securityHeaders } from "../next.config.mjs";

if (!existsSync("out")) {
  console.error("[htaccess] složka out/ neexistuje — nejdřív spusť STATIC_EXPORT=1 next build");
  process.exit(1);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rules = legacy
  .map(([from, to]) => `RewriteRule ^${esc(from.replace(/^\//, ""))}/?$ ${to === "/" ? "/" : to + (to.includes(".") ? "" : "/")} [R=301,L,NC]`)
  .join("\n");

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
  AddType text/x-component .txt
</IfModule>
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

  # Staré adresy původního webu → nové stránky
${rules}

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
console.log(`[htaccess] out/.htaccess zapsán (${legacy.length} přesměrování)`);
