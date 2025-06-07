import { verifyEmail } from '@devmehq/email-validator-js';

const { validFormat, validSmtp, validMx } = await verifyEmail({ emailAddress: 'foo@email.com', verifyMx: true, verifySmtp: true, timeout: 3000 });
// validFormat: true
// validMx: true
// validSmtp: true