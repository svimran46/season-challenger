import { Controller, Get, Res } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { REVIEW_PAGE_HTML } from './review-page';

/** The bit of Express's response this controller uses (the API has no @types/express). */
interface HtmlResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): HtmlResponse;
  send(body: string): unknown;
}

/**
 * The manual ID review page. It holds no data itself: the page asks for the reviewer token and
 * calls the /v1/review routes with it.
 */
@Controller('review')
export class ReviewPageController {
  @Get()
  page(@Res() res: HtmlResponse) {
    const nonce = randomBytes(16).toString('base64');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'nonce-${nonce}'`,
        'img-src blob:',
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    res.status(200).send(REVIEW_PAGE_HTML.replaceAll('__NONCE__', nonce));
  }
}
