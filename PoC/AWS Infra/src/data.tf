data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-2023.6*-kernel-*-x86_64"]
  }
}
