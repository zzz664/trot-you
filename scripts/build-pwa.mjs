import { runBuildCommand } from '@serwist/cli';
import config from '../serwist.config.mjs';

// Use the rejecting API rather than the CLI's log-only configuration failure.
// A missing manifest/failed bundle must fail the application's build.
await runBuildCommand({ config, watch: false });
