resource "aws_security_group" "public_ec2_sg" {
  name        = "public-ec2-security-group"
  description = "Allow SSH to public EC2"
  vpc_id      = module.vpc.vpc_id

  # SSH 접근 허용
  ingress {
    description = "SSH inbound"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  # HTTP 접근 허용 - ALB에서만 허용으로 변경
  ingress {
    description     = "HTTP inbound from ALB only"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
  }

  # 모든 아웃바운드 트래픽 허용
  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(
    local.tags,
    {
      Name = "public-ec2-security-group"
    }
  )
}

# ALB 보안 그룹 생성
resource "aws_security_group" "alb_sg" {
  name        = "alb-security-group"
  description = "Allow HTTP/HTTPS to ALB"
  vpc_id      = module.vpc.vpc_id

  # HTTP 접근 허용
  ingress {
    description = "HTTP inbound"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTPS 접근 허용
  ingress {
    description = "HTTPS inbound"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # 모든 아웃바운드 트래픽 허용
  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(
    local.tags,
    {
      Name = "alb-security-group"
    }
  )
}
