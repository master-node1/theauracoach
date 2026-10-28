# infra/terraform

AWS platform for ADR-007 Stage 1 (k3s on EC2). Not applied: see
[docs/operations/infrastructure.md](../../docs/operations/infrastructure.md) for what each
account gets, the cost check and the owner's apply steps.

```sh
terraform fmt -check -recursive
for root in bootstrap envs/prod envs/nonprod; do
  terraform -chdir=$root init -backend=false && terraform -chdir=$root validate
done
tflint --init && tflint --recursive --config "$PWD/.tflint.hcl"
checkov -d . --framework terraform --quiet --compact
```

The same checks run in `.github/workflows/terraform.yml`.
