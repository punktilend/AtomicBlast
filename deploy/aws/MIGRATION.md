# AtomicBlast AWS Migration

Target host: `blast.atomicradius.app`

Current live host: RackNerd `racknerd-atomicblast` / `23.95.216.131`, PM2 process `pulse-proxy`.

AWS account/region verified locally:

- Account: `817378414866`
- Principal: `arn:aws:iam::817378414866:user/adam-admin`
- Region: `us-east-1`

## Migration Shape

AtomicBlast is a single Node.js/Express service that serves both the web PWA and the API/proxy endpoints. The AWS path is therefore simpler than AtomicRadius:

- Reuse the existing `atomic-radius-prod` ECS cluster.
- Reuse the existing `atomic-radius-prod` public ALB and issued `atomicradius.app` ACM certificate.
- Add a host-based HTTPS listener rule for `blast.atomicradius.app`.
- Run one Fargate service from an `atomic-blast-server` ECR image.
- Mount EFS at `/data` and run the container with `STATE_DIR=/data` for JSON state/cache files.
- Keep Backblaze B2 as the music origin for this first transfer. A later B2-to-S3 migration can be handled separately.

## Important Current State

`blast.atomicradius.app` currently has an A record pointing directly at `23.95.216.131`. Do not flip this to the ALB until the ECS service has a healthy running task and the public endpoints pass.

The server code still contains fallback B2 credentials for legacy deployment compatibility. The AWS task definition reads B2 and OAuth credentials from SSM parameters, so the image should not rely on those fallbacks. Rotate/remove the hardcoded fallbacks after RackNerd is no longer the active production host.

## Files

| File | Purpose |
|---|---|
| `AtomicBlast-Server/Dockerfile` | Production image for the Node server/PWA with `ffmpeg`. |
| `deploy/aws/foundation.yaml` | ECR, EFS, access point, log group, and supporting security group. |
| `deploy/aws/service.yaml` | ECS task definition, target group, HTTPS host rule, and Fargate service. |
| `deploy/aws/dns-cutover.yaml` | Optional Route 53 alias cutover for `blast.atomicradius.app`. |
| `deploy/aws/sync-runtime-parameters.ps1` | Creates/updates SSM config and secret parameters. |
| `deploy/aws/deploy-foundation.ps1` | Deploys the AWS foundation stack. |
| `deploy/aws/deploy-service.ps1` | Deploys the task/service stack, default desired count `0`. |
| `deploy/aws/build-push-image.ps1` | Builds and pushes the server image to ECR. |
| `deploy/aws/deploy-codebuild-image-builder.ps1` | Creates an AWS CodeBuild Docker image builder when local Docker is unavailable. |
| `deploy/aws/build-push-image-codebuild.ps1` | Uploads the current server source and builds/pushes the image in CodeBuild. |
| `deploy/aws/deploy-dns-cutover.ps1` | Flips `blast.atomicradius.app` to the shared ALB. |
| `deploy/aws/test-public-endpoints.ps1` | Smoke tests public HTTP endpoints after cutover. |

## Run Order

1. Seed runtime parameters:

```powershell
pwsh -File deploy/aws/sync-runtime-parameters.ps1
```

2. Deploy foundation:

```powershell
pwsh -File deploy/aws/deploy-foundation.ps1
```

3. Build and push the image. If Docker is installed locally:

```powershell
pwsh -File deploy/aws/build-push-image.ps1 -ImageTag aws-prep
```

If Docker is not available locally:

```powershell
pwsh -File deploy/aws/deploy-codebuild-image-builder.ps1
pwsh -File deploy/aws/build-push-image-codebuild.ps1 -ImageTag aws-prep
```

4. Deploy ECS service at zero desired count:

```powershell
pwsh -File deploy/aws/deploy-service.ps1 -ImageTag aws-prep
```

5. Scale up for validation:

```powershell
pwsh -File deploy/aws/deploy-service.ps1 -ImageTag aws-prep -DesiredCount 1
```

6. When the target is healthy, cut DNS over:

```powershell
pwsh -File deploy/aws/deploy-dns-cutover.ps1
```

7. Smoke test:

```powershell
pwsh -File deploy/aws/test-public-endpoints.ps1
```

## Runtime Parameters

Config path: `/atomic-blast/prod/config`

- `NODE_ENV`
- `PORT`
- `PUBLIC_ORIGIN`
- `B2_BUCKET`
- `B2_BUCKET_URL`
- `B2_PREFIX`
- `AUTH_SUPPORT_EMAIL`
- `GOOGLE_REDIRECT_URI`

Secret path: `/atomic-blast/prod/secrets`

- `B2_KEY_ID`
- `B2_APP_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `LASTFM_API_KEY`
