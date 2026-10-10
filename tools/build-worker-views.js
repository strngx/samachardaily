/**
 * Samachar Daily — Worker Admin Views Builder
 *
 * Compiles the private newsroom login and Editorial Control Center templates
 * into a private ES module for Cloudflare Workers (worker/admin-views.js),
 * and guarantees that _site/admin/ is completely purged from public static assets.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const siteDir = path.join(rootDir, '_site');
const adminDirInSite = path.join(siteDir, 'admin');
const workerViewsFile = path.join(rootDir, 'worker', 'admin-views.js');

function buildAdminViews() {
  console.log('[Worker Views Builder] Compiling private admin templates with Eleventy...');

  // 1. Run Eleventy with INCLUDE_ADMIN=true to render the admin templates
  try {
    execSync('npx @11ty/eleventy', {
      cwd: rootDir,
      env: {
        ...process.env,
        INCLUDE_ADMIN: 'true'
      },
      stdio: 'pipe'
    });
  } catch (err) {
    console.error('[Worker Views Builder] Failed to render admin templates:', err.message);
    process.exit(1);
  }

  // 2. Locate generated admin files
  const loginHtmlPath = path.join(adminDirInSite, 'index.html');
  const editorialHtmlPath = path.join(adminDirInSite, 'editorial', 'index.html');

  if (!fs.existsSync(loginHtmlPath)) {
    console.error('[Worker Views Builder] Expected login file not found at:', loginHtmlPath);
    process.exit(1);
  }
  if (!fs.existsSync(editorialHtmlPath)) {
    console.error('[Worker Views Builder] Expected editorial control center not found at:', editorialHtmlPath);
    process.exit(1);
  }

  const loginHtml = fs.readFileSync(loginHtmlPath, 'utf8');
  const editorialHtml = fs.readFileSync(editorialHtmlPath, 'utf8');

  // Purge adminDirInSite immediately so static isolation is enforced before builders run
  if (fs.existsSync(adminDirInSite)) {
    fs.rmSync(adminDirInSite, { recursive: true, force: true });
    console.log('[Worker Views Builder] Strictly purged _site/admin/ from static assets.');
  }

  let qualityIndexJson = '{}';
  try {
    const { buildQualityIndex } = require('../scripts/build-quality-index.js');
    qualityIndexJson = buildQualityIndex();
  } catch (err) {
    console.error('[Worker Views Builder] Failed to build quality index:', err.message);
  }

  let internalLinksJson = '{}';
  try {
    const { buildInternalLinksIndex } = require('../scripts/build-internal-links.js');
    internalLinksJson = buildInternalLinksIndex();
  } catch (err) {
    console.error('[Worker Views Builder] Failed to build internal links index:', err.message);
  }

  let siteHealthJson = '{}';
  try {
    const { buildSiteHealthIndex } = require('../scripts/build-site-health.js');
    siteHealthJson = buildSiteHealthIndex();
  } catch (err) {
    console.error('[Worker Views Builder] Failed to build site health index:', err.message);
  }

  // 3. Write worker/admin-views.js as an ES module
  const outputCode = `/**
 * Samachar Daily — Pre-compiled Private Admin Views
 * Generated automatically by tools/build-worker-views.js.
 * DO NOT EDIT MANUALLY.
 */

export const loginHtml = ${JSON.stringify(loginHtml)};

export const editorialHtml = ${JSON.stringify(editorialHtml)};

export const qualityIndexJson = ${JSON.stringify(qualityIndexJson)};

export const internalLinksJson = ${JSON.stringify(internalLinksJson)};

export const siteHealthJson = ${JSON.stringify(siteHealthJson)};
`;

  fs.mkdirSync(path.dirname(workerViewsFile), { recursive: true });
  fs.writeFileSync(workerViewsFile, outputCode, 'utf8');
  console.log('[Worker Views Builder] Successfully generated worker/admin-views.js (' + (outputCode.length / 1024).toFixed(1) + ' KB)');

  // 4. CRITICAL: Strictly delete _site/admin to enforce 100% production static isolation!
  if (fs.existsSync(adminDirInSite)) {
    fs.rmSync(adminDirInSite, { recursive: true, force: true });
    console.log('[Worker Views Builder] Strictly purged _site/admin/ from static assets.');
  }

  const adminExists = fs.existsSync(adminDirInSite);
  if (adminExists) {
    console.error('[Worker Views Builder] CRITICAL ERROR: _site/admin still exists!');
    process.exit(1);
  } else {
    console.log('[Worker Views Builder] Production static isolation verified: _site/admin does NOT exist.');
  }
}

if (require.main === module) {
  buildAdminViews();
}

module.exports = { buildAdminViews };
