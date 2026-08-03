import { createHash, createHmac } from 'node:crypto';

/**
 * The minimum of AWS Signature Version 4 needed to prove that a runtime
 * credential pair actually opens one exact bucket.
 *
 * Why this exists rather than an SDK: the factory ships no AWS dependency, and
 * the only S3 call it ever makes is this one. A signed HEAD is ~40 lines; an SDK
 * would be a supply-chain surface for a single request, on a tool whose whole
 * point is that it can be audited.
 *
 * Why it exists at all: the bucket's own canary runs through the Cloudflare API
 * with the control token, so nothing in the provisioning path ever exercised the
 * runtime pair. Binding a pair scoped to a different bucket therefore succeeded,
 * and produced a green provisioning receipt on an application that could not
 * write a single object.
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
/** R2 requires a region and ignores it, exactly as Cloudflare documents. */
const REGION = 'auto';
/** A signed request with no body: the payload hash of the empty string. */
const EMPTY_PAYLOAD_SHA256 = createHash('sha256').update('').digest('hex');

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/**
 * Build the `Authorization` header for a HEAD against a bucket root.
 *
 * `now` is a parameter rather than read from the clock so the signature is a
 * pure function of its inputs and can be pinned by a test.
 */
export function signR2HeadBucket(input: {
  accessKeyId: string;
  secretAccessKey: string;
  host: string;
  bucket: string;
  now: Date;
}): { authorization: string; amzDate: string; payloadSha256: string } {
  const amzDate = `${input.now
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, '')
    .slice(0, 15)}Z`;
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;

  const canonicalRequest = [
    'HEAD',
    `/${encodeURIComponent(input.bucket)}`,
    '',
    `host:${input.host}`,
    `x-amz-content-sha256:${EMPTY_PAYLOAD_SHA256}`,
    `x-amz-date:${amzDate}`,
    '',
    'host;x-amz-content-sha256;x-amz-date',
    EMPTY_PAYLOAD_SHA256,
  ].join('\n');

  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), REGION), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    authorization: `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    amzDate,
    payloadSha256: EMPTY_PAYLOAD_SHA256,
  };
}
