import '@nota/core/bootstrap/electron';
import '@nota/core/bootstrap/cleanup';
import '@nota/component/theme';
import './global.css';

import { apis } from '@nota/electron-api';
import { bindNativeDBApis } from '@nota/nbstore/sqlite';
import { bindNativeDBV1Apis } from '@nota/nbstore/sqlite/v1';

// oxlint-disable-next-line no-non-null-assertion
bindNativeDBApis(apis!.nbstore);
// oxlint-disable-next-line no-non-null-assertion
bindNativeDBV1Apis(apis!.db);
