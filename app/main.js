import { initTheme } from '../_lib/core/theme/theme.js';
import './strings.js';
import { setLocale, getLocale } from '../_lib/core/strings.js';
import { boot } from '../_lib/core/store/store.js';
import { reducer } from './store/reducer.js';
import { DB_NAME } from './store/db-name.js';
import '../_lib/core/router/app-router.js';
import { setBasePath } from '../_lib/core/router/router.js';
import '../_lib/core/sw-manager/sw-manager.js';
import '../_lib/core/components/update-banner/update-banner.js';
import '../_lib/modules/app-header/app-header.js';
import '../_lib/modules/modal-dialog/modal-dialog.js';
import './pages/home-page.js';
import './pages/capture-page.js';
import './pages/not-found-page.js';


initTheme();
setLocale(getLocale());

await boot({ dbName: DB_NAME, reducer });

const swm = document.createElement('sw-manager');
swm.setAttribute('base-path', __BASE_PATH__);

// Routes below are prefix-free ('/', '/bout/:id/capture'). This tells the
// router the prefix the app is actually served under: '/' locally, and
// '/point-capture/' on the GitHub project page. Without it the deployed app
// rendered not-found-page on its own home screen, because /point-capture/
// never matched '/'. Must run before routes are assigned.
setBasePath(__BASE_PATH__);
swm.setAttribute('app-version', __APP_VERSION__);
document.body.prepend(swm);

console.log('Point Capture', __APP_VERSION__);

const router = document.querySelector('app-router');
router.routes = [
  { path: '/', component: 'home-page' },
  { path: '/bout/:id/capture', component: 'capture-page' },
  { path: '*', component: 'not-found-page' },
];
