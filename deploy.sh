#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

rm -rf .next
npm run build

scp -r .next/standalone/* root@209.38.126.3:/root/suralgo-frontend/
scp -r .next/standalone/.next root@209.38.126.3:/root/suralgo-frontend/
scp -r .next/static root@209.38.126.3:/root/suralgo-frontend/.next/
scp -r public root@209.38.126.3:/root/suralgo-frontend/