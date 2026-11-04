// Types for `./google`. Metro picks google.native.ts or google.web.ts at bundle time; this file
// only tells TypeScript what both of them export.
import type { UseGoogleSignIn } from './google.types';

/** Whether this platform can offer Google sign-in at all. */
export declare const googleSignInSupported: boolean;

export declare const useGoogleSignIn: UseGoogleSignIn;
