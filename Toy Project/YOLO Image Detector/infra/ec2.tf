resource "tls_private_key" "public_ec2_key" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "public_ec2_keypair" {
  key_name   = "public-ec2-keypair.pem"
  public_key = tls_private_key.public_ec2_key.public_key_openssh
}

resource "local_file" "public_ec2_local" {
  filename        = "./keypair/public-ec2-keypair.pem"
  content         = tls_private_key.public_ec2_key.private_key_pem
  file_permission = "0600"
}

resource "aws_instance" "public_ec2" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = "t2.micro"
  subnet_id              = element(module.vpc.public_subnets, 0)
  vpc_security_group_ids = [aws_security_group.public_ec2_sg.id]
  key_name               = aws_key_pair.public_ec2_keypair.key_name
  iam_instance_profile   = aws_iam_instance_profile.admin.name

  ebs_block_device {
    device_name           = "/dev/xvda"
    volume_type           = "gp3"
    volume_size           = 30
    delete_on_termination = true
  }

  user_data = file("${path.module}/user_data/user_data.sh")

  tags = merge(
    local.tags,
    {
      Name = "public-ec2"
    }
  )
}

resource "aws_eip" "public_ec2_eip" {
  domain   = "vpc"
  instance = aws_instance.public_ec2.id

  depends_on = [module.vpc]

  tags = merge(
    local.tags,
    {
      Name = "public-ec2-eip"
    }
  )
}

resource "aws_eip_association" "eip_assoc" {
  instance_id   = aws_instance.public_ec2.id
  allocation_id = aws_eip.public_ec2_eip.id
}
