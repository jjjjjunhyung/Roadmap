FROM python:3.11-slim

# 임시 디렉토리 생성 및 권한 설정
RUN mkdir -p /tmp/gradio && \
    chmod 777 /tmp/gradio

WORKDIR /app

# apt 업데이트 및 필요한 시스템 의존성 설치
RUN apt-get update && \
    apt-get install -y \
    git \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# scipy와 numpy 호환 버전 설치
RUN pip install --no-cache-dir \
    numpy==1.24.3 \
    scipy==1.10.1 \
    matplotlib==3.7.2

# YOLOv5 사용 관련 패키지 설치
RUN pip install --no-cache-dir \
    gitpython==3.1.32 \
    seaborn==0.12.2 \
    pandas==2.0.3

# OpenCV 및 웹 어플리케이션 관련 패키지 설치
RUN pip install --no-cache-dir \
    opencv-python-headless==4.8.0.74 \
    onnxruntime==1.15.1 \
    gradio

# 애플리케이션 코드 복사
COPY app.py .

# 환경 변수 설정
ENV PORT=7860

# 컨테이너 실행
CMD ["python", "app.py"]

EXPOSE 7860 
