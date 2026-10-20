import { ROLE_MSP, type CallerIdentity, type Role } from '@billbridge/shared';

export interface UserLike { role: Role; participantId: string }

/** Caller identity for a platform user (mock: explicit; Fabric: selects `identities/<participantId>/`). */
export function callerFor(user: UserLike): CallerIdentity {
  return { mspId: ROLE_MSP[user.role], role: user.role, participantId: user.participantId };
}

export const BOOTSTRAP_OPERATOR_ID = 'operator1';

/** The bootstrap operator (created by InitLedger). Used for platform-driven transactions. */
export function operatorCaller(): CallerIdentity {
  return { mspId: ROLE_MSP.OPERATOR, role: 'OPERATOR', participantId: BOOTSTRAP_OPERATOR_ID };
}
