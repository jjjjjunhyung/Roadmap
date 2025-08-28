# 객체 인식 애플리케이션 ([테스트 링크](https://www.junhyung.xyz))
이 프로젝트는 이미지에서 객체를 인식하는 Gradio 애플리케이션을 AWS 인프라에 최저비용으로 배포한 구조를 보여줍니다. <br>
[YOLOv5m 모델](https://huggingface.co/Ultralytics/YOLOv5)과 ONNX Runtime을 사용하여 CPU 기반 객체 감지를 구현했습니다. <br>
Terraform으로 구성된 인프라와 Docker 컨테이너로 배포된 애플리케이션을 포함합니다.

## 애플리케이션 기능
- Gradio 웹 인터페이스
- YOLOv5m 모델을 사용한 객체 감지
- ONNX Runtime을 통한 CPU 기반 추론
- 80개 COCO 클래스 객체 감지 지원

## 기술 스택
- 객체 감지: YOLOv5m (ONNX 버전)
- 웹 인터페이스: Gradio
- 이미지 처리: OpenCV, NumPy
- 추론 엔진: ONNX Runtime
- 배포: Docker, AWS

## 인프라 비용
- 도메인 비용
- AWS free tier 계정
- AWS Route53 호스팅 영역: 0.5$ per month
- AWS ALB: 0$ (~ 15 LCU)
- AWS EC2: 0$ (t2.micro)
- AWS EBS: 0$ (~ 30 GB)
- AWS ECR: 0$ (~ 500 MB)
- AWS IAM: 0$

## 인프라 구조 개요
```mermaid
graph TB
    subgraph "🌐 Client Layer"
        U1[👤 Guest User A<br/>Browser]
        U2[👤 Guest User B<br/>Browser]
        U3[👤 Guest User C<br/>Browser]
    end

    subgraph "☁️ Oracle Cloud Infrastructure"
        LB[📡 Load Balancer<br/>SSL/TLS Termination<br/>Let's Encrypt]

        subgraph "💻 Ampere A1 Instance"
            NGINX[🔄 Nginx Proxy<br/>Load Balancing<br/>X-Next-Cursor Headers]

            subgraph "🎨 Frontend Layer"
                REACT[⚛️ React App<br/>Socket.IO Client<br/>Material-UI<br/>React Query + Infinite Scroll]
            end

            subgraph "⚡ Backend Layer (x2)"
                NESTJS1[🏗️ NestJS #1<br/>Socket.IO + REST API<br/>Cursor Pagination]
                NESTJS2[🏗️ NestJS #2<br/>Socket.IO + REST API<br/>Cursor Pagination]
            end

            subgraph "💾 Data & Messaging Layer"
                REDIS[⚡ Redis Server<br/>Socket.IO Clustering<br/>Pub/Sub Hub<br/>User Profile Cache<br/>Online Status Management]

                subgraph "📢 Redis Channels"
                    PUBSUB_ROOM[📢 Room Events<br/>Message Updates]
                    PUBSUB_USER[📢 User Events<br/>Join/Leave/Online Status]
                    PUBSUB_TYPING[📢 Typing Events]
                end

                MONGO[🗄️ MongoDB<br/>Chat Data Storage<br/>Optimized Queries<br/>Cursor-based Pagination]
                MINIO[📁 MinIO<br/>File Storage]
            end
        end
    end

    %% WebSocket Connections (Real-time)
    U1 -.->|🔌 WebSocket<br/>Socket.IO + JWT<br/>User-specific Rooms| LB
    U2 -.->|🔌 WebSocket<br/>Socket.IO + JWT<br/>User-specific Rooms| LB
    U3 -.->|🔌 WebSocket<br/>Socket.IO + JWT<br/>User-specific Rooms| LB

    %% HTTP Connections
    U1 -->|📄 HTTP<br/>REST API + Cursor Headers| LB
    U2 -->|📄 HTTP<br/>REST API + Cursor Headers| LB
    U3 -->|📄 HTTP<br/>Static Files| LB

    LB --> NGINX
    NGINX --> REACT
    NGINX --> NESTJS1
    NGINX --> NESTJS2

    %% Socket.IO Clustering
    NESTJS1 -.->|📡 Cluster Sync<br/>Profile Cache| REDIS
    NESTJS2 -.->|📡 Cluster Sync<br/>Profile Cache| REDIS

    %% Real-time Message Flow
    NESTJS1 -.->|📢 Publish| PUBSUB_ROOM
    NESTJS2 -.->|📢 Publish| PUBSUB_USER
    NESTJS1 -.->|📢 Subscribe| PUBSUB_TYPING
    NESTJS2 -.->|📢 Subscribe| PUBSUB_TYPING

    PUBSUB_ROOM --> REDIS
    PUBSUB_USER --> REDIS
    PUBSUB_TYPING --> REDIS

    %% Data Persistence
    NESTJS1 --> MONGO
    NESTJS2 --> MONGO
    NESTJS1 --> MINIO
    NESTJS2 --> MINIO

    %% Session Management
    NESTJS1 -.->|🎫 Sessions<br/>Online Counters| REDIS
    NESTJS2 -.->|🎫 Cache<br/>User Profiles| REDIS

    %% Styling
    classDef websocket fill:#e3f2fd,stroke:#1976d2,stroke-width:3px,stroke-dasharray: 5 5
    classDef pubsub fill:#fff3e0,stroke:#f57c00,stroke-width:3px
    classDef realtime fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef storage fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px

    class U1,U2,U3 websocket
    class PUBSUB_ROOM,PUBSUB_USER,PUBSUB_TYPING,REDIS pubsub
    class NESTJS1,NESTJS2,REACT realtime
    class MONGO,MINIO storage
```

## 인프라 구성 요소

### 1. Amazon Route53
- 도메인 이름: **junhyung.xyz**
- 서브도메인: **www.junhyung.xyz**
- Route53 DNS 레코드가 EC2로 트래픽을 라우팅합니다.

### 2. AWS Certificate Manager (ACM)
- 도메인 및 서브도메인을 위한 SSL/TLS 인증서 제공
- DNS 검증 방식으로 인증서 확인
- ALB를 위한 HTTPS 연결 지원

### 3. Amazon VPC
- CIDR: **10.0.0.0/16**
- 가용 영역: **ap-northeast-2a, ap-northeast-2b, ap-northeast-2c, ap-northeast-2d**
- 퍼블릭 서브넷: **10.0.101.0/24, 10.0.102.0/24, 10.0.103.0/24, 10.0.104.0/24**
- 프라이빗 서브넷: **10.0.1.0/24, 10.0.2.0/24, 10.0.3.0/24, 10.0.4.0/24**

### 4. Application Load Balancer (ALB)
- 여러 가용 영역에 걸쳐 고가용성 제공
- SSL/TLS 종료 처리 (HTTPS 요청을 HTTP로 변환)
- ACM 인증서를 사용한 HTTPS 지원
- HTTP에서 HTTPS로 자동 리디렉션 구현
- 보안 그룹: HTTP(80), HTTPS(443) 트래픽 허용
- EC2 인스턴스 대상 그룹으로 트래픽 라우팅

### 5. Amazon EC2
- 인스턴스 유형: **t2.micro**
- 퍼블릭 서브넷에 배치
- Elastic IP 할당
- 보안 그룹: SSH(22), HTTP(80), HTTPS(443) 트래픽 허용

### 6. Amazon ECR
- 리포지토리 이름: **app-repository**
- 이미지 수명주기 정책: 최대 3개 이미지 유지

### 7. Docker Compose 구성
```yaml
services:
  nginx:
    image: *.dkr.ecr.ap-northeast-2.amazonaws.com/app-repository:nginx
    ports:
      - "80:80"
    depends_on:
      - app
    restart: always

  app:
    image: *.dkr.ecr.ap-northeast-2.amazonaws.com/app-repository:app
    restart: always
    environment:
      - PORT=7860
```
