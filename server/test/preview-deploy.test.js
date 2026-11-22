'use strict';

// Static checks of the preview deployment files (nothing here is applied anywhere): they must stay isolated from production.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', '..', 'deploy', 'preview');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const strip = (t) => t.replace(/^\s*#.*$/gm, '');
const compose = strip(read('docker-compose.preview.yml'));
const prod = strip(fs.readFileSync(path.join(__dirname, '..', '..', 'docker-compose.yml'), 'utf8'));
const nginx = strip(read('nginx-preview-stats.conf'));
const env = read('preview.env.example');

test('preview compose shares nothing with the production compose', () => {
  const val = (t, re) => [...t.matchAll(re)].map((m) => m[1]);
  assert.match(compose, /^name:\s*vectis-preview$/m);
  for (const re of [/container_name:\s*(\S+)/g, /^\s+name:\s*(\S+)/gm, /"127\.0\.0\.1:(\d+):\d+"/g, /^\s+- (\/etc\/\S+)/gm, /subnet:\s*(\S+)/g]) {
    const a = val(compose, re); const b = val(prod, re);
    assert.ok(a.length > 0, String(re));
    for (const x of a) assert.ok(!b.includes(x), `${x} is also used by production`);
  }
  assert.match(compose, /127\.0\.0\.1:3101:3100/);
  assert.match(compose, /PREVIEW_MODE:\s*"1"/);
  assert.match(compose, /PUBLIC_ORIGIN:\s*https:\/\/preview-stats\.mrprop\.fr/);
  assert.doesNotMatch(compose, /\/etc\/devis-vectis\/|devis_vectis_|devis\.mrprop\.fr|3100:3100/);
  assert.doesNotMatch(compose, /GOOGLE|MAIL_|STATS_ENABLED/);
  assert.match(compose, /TRUST_PROXY:\s*172\.28\.77\.1/);
  assert.match(compose, /gateway:\s*172\.28\.77\.1/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
});

test('preview env example holds no real secret and no Google/mail setting', () => {
  assert.match(env, /ADMIN_EMAILS=preview-admin@preview\.invalid/);
  assert.doesNotMatch(strip(env), /GOOGLE|MAIL_SETUP|MAIL_SENDER|QUOTE_RECIPIENT/);
  assert.doesNotMatch(env, /SESSION_SECRET=[0-9a-f]{32,}/);
});

test('preview nginx vhost: own host, basic auth, noindex, proxy to 3101 only, no production snippet', () => {
  assert.equal([...nginx.matchAll(/server_name\s+([^;]+);/g)].every((m) => m[1].trim() === 'preview-stats.mrprop.fr'), true);
  assert.doesNotMatch(nginx, /devis\.mrprop\.fr|snippets\/devis-vectis|127\.0\.0\.1:3100/);
  assert.match(nginx, /auth_basic\s+"VECTIS preview";/);
  assert.match(nginx, /auth_basic_user_file\s+\/etc\/nginx\/preview-stats\.htpasswd;/);
  assert.match(nginx, /X-Robots-Tag\s+"noindex, nofollow, noarchive"/);
  assert.deepEqual([...nginx.matchAll(/proxy_pass\s+([^;]+);/g)].map((m) => m[1]), ['http://127.0.0.1:3101']);
  assert.match(nginx, /proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;/);
  assert.doesNotMatch(nginx, /\$proxy_add_x_forwarded_for/);
  assert.match(nginx, /location\s+\^~\s+\/api\/\s*\{/);
  for (const d of ['/server/', '/deploy/', '/.github/']) assert.ok(nginx.includes(`location ^~ ${d} { return 404; }`), d);
  const ext = nginx.match(/location\s+~\*\s+\\\.\(([^)]+)\)\$/)[1].split('|');
  for (const e of ['db', 'env', 'sh', 'md', 'json', 'yml', 'example']) assert.ok(ext.includes(e), e);
});

test('preview nginx: own logs, htpasswd credentials never forwarded, HTTP-only phase file for the certificate, no production include', () => {
  const full = nginx;
  const http = strip(read('nginx-preview-stats-http.conf'));
  assert.match(full, /access_log\s+\/var\/log\/nginx\/preview-stats\.access\.log;/);
  assert.match(full, /error_log\s+\/var\/log\/nginx\/preview-stats\.error\.log;/);
  assert.match(full, /proxy_set_header Authorization "";/);
  assert.match(full, /proxy_pass http:\/\/127\.0\.0\.1:3101;/);
  assert.doesNotMatch(full, /127\.0\.0\.1:3100|include\s|devis\.mrprop\.fr|devis-vectis-headers/);
  assert.match(full, /auth_basic_user_file \/etc\/nginx\/preview-stats\.htpasswd;/);
  assert.match(full, /X-Robots-Tag "noindex, nofollow, noarchive"/);
  assert.doesNotMatch(http, /listen 443|ssl_certificate|proxy_pass/);
  assert.match(http, /server_name preview-stats\.mrprop\.fr;/);
  assert.match(http, /acme-challenge/);
});

test('preview README: only project-scoped Docker commands, no global cleanup, certbot webroot only', () => {
  const md = read('README.md');
  const cmds = md.split('\n').filter((l) => /^\s*(sudo\s+)?(docker|certbot)\b/.test(l)).join('\n');
  assert.doesNotMatch(cmds, /prune|system |volume rm|compose down -v|--volumes|rm -rf|--nginx|devis_vectis_network|devis-vectis-api\b/);
  assert.match(md, /-p vectis-preview -f deploy\/preview\/docker-compose\.preview\.yml up -d --build/);
  assert.match(md, /down\s+# SANS -v/);
  assert.match(md, /certbot certonly --webroot/);
  assert.match(md, /72\.62\.27\.129/);
});

test('preview-fase1.sh: syntax, www-data:www-data for the htpasswd, project-scoped Docker only, production only read', () => {
  const sh = read('preview-fase1.sh');
  const code = strip(sh);
  const r = require('node:child_process').spawnSync('bash', ['-n', path.join(dir, 'preview-fase1.sh')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(code, /^set -euo pipefail$/m);
  assert.match(code, /chown www-data:www-data "\$HTP"; chmod 640 "\$HTP"/);
  assert.doesNotMatch(code, /ps -o|NGU|NGG|chgrp/, 'no detection of nginx processes (containers also run nginx)');
  assert.doesNotMatch(code, /prune|docker system|volume rm|network rm|docker rm|docker rmi|docker stop|docker kill|docker restart|compose down -v|--volumes|rm -rf|\brm /, 'nothing is deleted or stopped');
  assert.doesNotMatch(code, /certbot|systemctl|nginx -s|nginx -t|sites-enabled|sites-available|ufw|iptables/, 'no DNS/Nginx/certificate/firewall operation');
  for (const l of code.split('\n').filter((x) => /\bdocker (run|compose|exec|network|volume|image|container)\b/.test(x))) {
    if (/^COMPOSE=|\$COMPOSE|docker exec \$CT/.test(l.trim())) continue;
    assert.match(l, /docker (network (ls|inspect)|volume inspect|image inspect|inspect|ps|port)/, 'read-only Docker command expected: ' + l);
  }
  assert.match(code, /COMPOSE="docker compose -p vectis-preview -f deploy\/preview\/docker-compose\.preview\.yml"/);
  assert.match(code, /\$COMPOSE up -d --build/);
  // production: only read (inspect / rev-parse / remote get-url / health)
  const prodLines = code.split('\n').filter((x) => /devis-vectis-api|\$PROD|devis_vectis_network|3100/.test(x));
  assert.ok(prodLines.length > 0);
  for (const l of prodLines) assert.doesNotMatch(l, /\b(rm|mv|cp|chmod|chown|git (pull|checkout|reset|merge|fetch|clone)|docker (compose|restart|stop|exec))\b|>/, l);
  assert.match(code, /EXPECT="\$\{1:-\}"/);
  assert.match(code, /\[0-9a-f\]\{7\}.*uso: bash preview-fase1\.sh/);
  assert.match(code, /\[ "\$SHA" = "\$EXPECT" \]/);
  assert.ok(code.indexOf('ls-remote') < code.indexOf('git clone'), 'commit checked before the clone');
  assert.ok(code.indexOf('git clone') < code.indexOf('up -d --build'), 'clone before build');
});
