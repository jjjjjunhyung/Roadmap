#!/bin/bash
# EC2 인스턴스 부팅시 실행되는 스크립트

# 기본 패키지 설치
yum update -y
yum install -y docker git python3 python3-pip lsof

# Docker 서비스 시작 및 자동 실행 설정
systemctl start docker
systemctl enable docker

# Docker 실행 권한 설정
usermod -a -G docker ec2-user

# Docker Compose 플러그인 설치
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# 스왑 파일 설정
dd if=/dev/zero of=/swapfile bs=128M count=16
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile swap swap defaults 0 0' | tee -a /etc/fstab

echo "EC2 인스턴스 초기화가 완료되었습니다."
