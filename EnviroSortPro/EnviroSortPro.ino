#include <Servo.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);
Servo tap_servo;
Servo tap_servo1;

int metal_sensor_pin = 4;
int plastic_sensor_pin = 3;
int bio_sensor_pin = 7;
const int trigPin = 8;
const int echoPin = 9;
const int buzzerPin = 12;
const int buttonPin = 10;
const int ledPin = 2;
const int ledPin1 = 13;
const int ledPin2 = A3;

bool obstacleDetected = false;
bool operationsEnabled = true;

bool metalDetected = false;
bool plasticDetected = false;
bool bioDetected = false;

void setup() {
  pinMode(bio_sensor_pin, INPUT);
  pinMode(metal_sensor_pin, INPUT);
  pinMode(plastic_sensor_pin, INPUT);
  tap_servo.attach(5);
  tap_servo1.attach(6);
  Serial.begin(9600);
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  pinMode(buzzerPin, OUTPUT);
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
  pinMode(ledPin1, OUTPUT);
  pinMode(ledPin2, OUTPUT);

  resetServosAndLCD();
}

void resetServosAndLCD() {
  tap_servo.write(90);
  tap_servo1.write(180);
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Automatic Waste");
  lcd.setCursor(0, 1);
  lcd.print("Segregation");
  digitalWrite(ledPin, LOW);
  digitalWrite(ledPin1, LOW);
  digitalWrite(ledPin2, LOW);
}

void loop() {
  if (detectionMaintenance()) return;
  handleWasteDetection();
  delay(500);
}

bool detectionMaintenance() {
  long duration = triggerUltrasonic();
  int distance = calculateDistance(duration);
  debugDistance(distance);

if (distance <= 20 && !obstacleDetected)  {
    obstacleDetected = true;
    soundAlarm();
    displayFullBin();
    operationsEnabled = false;
    return true;
  }  else if (distance > 20 && obstacleDetected) {
    obstacleDetected = false;
    stopAlarm();
  }

  if (!operationsEnabled && digitalRead(buttonPin) == LOW) {
    operationsEnabled = true;
    resetServosAndLCD();
  }

  return !operationsEnabled;
}

void handleWasteDetection() {
  int val_metal = digitalRead(metal_sensor_pin);
  int val_plastic = digitalRead(plastic_sensor_pin);
  int val_bio = digitalRead(bio_sensor_pin);

  if (val_metal == LOW) {
    changeLCD("Metal Waste", "Detected");
    moveServos(80, 0);
    metalDetected = true;
    digitalWrite(ledPin1, HIGH);
  } else {
    metalDetected = false;
    digitalWrite(ledPin1, LOW);
  }

  if (val_plastic == LOW && !metalDetected) {
    changeLCD("Plastic Waste", "Detected");
    moveServos(165, 0);
    plasticDetected = true;
    digitalWrite(ledPin, HIGH);
  } else {
    plasticDetected = false;
    digitalWrite(ledPin, LOW);
  }

  if (val_bio == LOW) {
    changeLCD("Bio Waste", "Detected");
    moveServos(0, 0);
    bioDetected = true;
    digitalWrite(ledPin2, HIGH);
  } else {
    bioDetected = false;
    digitalWrite(ledPin2, LOW);
  }

  if (!metalDetected && !plasticDetected && !bioDetected) {
    resetServosAndLCD();
  }
}

void moveServos(int pos1, int pos2) {
  tap_servo.write(pos1);
  delay(1000);
  tap_servo1.write(pos2);
  delay(200);
}

void changeLCD(const char* line1, const char* line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1);
  lcd.setCursor(0, 1);
  lcd.print(line2);
}

long triggerUltrasonic() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  return pulseIn(echoPin, HIGH);
}

int calculateDistance(long duration) {
  return duration * 0.0343 / 2;
}

void debugDistance(int distance) {
  Serial.print("Distance: ");
  Serial.print(distance);
  Serial.println(" cm");
}

void soundAlarm() {
  digitalWrite(buzzerPin, HIGH);
  digitalWrite(ledPin, HIGH);
  digitalWrite(ledPin1, HIGH);
  digitalWrite(ledPin2, HIGH);
}

void stopAlarm() {
  digitalWrite(buzzerPin, LOW);
}

void displayFullBin() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Bin Full");
  lcd.setCursor(0, 1);
  lcd.print("Detected");
}
//made by judech
