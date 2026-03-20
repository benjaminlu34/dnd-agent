import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

export function backOrPush(
  router: AppRouterInstance,
  fallbackHref: string,
  expectedPathPrefix?: string,
) {
  const referrer = document.referrer;

  if (!referrer) {
    router.push(fallbackHref);
    return;
  }

  const referrerUrl = new URL(referrer);

  if (referrerUrl.origin !== window.location.origin) {
    router.push(fallbackHref);
    return;
  }

  if (expectedPathPrefix && !referrerUrl.pathname.startsWith(expectedPathPrefix)) {
    router.push(fallbackHref);
    return;
  }

  router.back();
}
