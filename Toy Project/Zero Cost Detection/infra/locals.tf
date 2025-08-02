locals {
  tags = {
    IaC         = "Terraform"
    Environment = "dev"
    UpdatedBy   = split("/", data.aws_caller_identity.current.arn)[1]
  }
}
