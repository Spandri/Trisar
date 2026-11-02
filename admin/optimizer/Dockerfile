FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY admin-app-lokal/optimizer/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY admin-app-lokal/optimizer /app/optimizer

EXPOSE 8790

CMD ["uvicorn", "optimizer.api_server:app", "--host", "0.0.0.0", "--port", "8790"]
