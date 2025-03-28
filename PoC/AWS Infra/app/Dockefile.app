FROM python:3.11-slim

WORKDIR /app

# 필요한 패키지 설치
COPY requirements.txt .
RUN pip install --no-cache-dir gradio==5.23.1

# 애플리케이션 코드 복사
COPY app.py .

# 환경 변수 설정
ENV PORT=7860

# 컨테이너 실행
CMD ["python", "app.py"]

EXPOSE 7860 
