# ITMS — Product Requirements Document

## 1. Product Overview

**ITMS (Intelligent Traffic Management System)** is an AI-powered traffic management and simulation platform designed to reduce emergency response time by predicting traffic conditions, optimizing emergency routes, and coordinating multiple traffic signals to create a predictive rolling green corridor.

The hackathon implementation will operate primarily as a **digital traffic twin / simulation platform** using SUMO. It will not directly control real municipal traffic signals.

## 2. Problem

Ambulances, fire engines, and police vehicles can lose critical time because of congestion, long signal cycles, poorly coordinated intersections, and unpredictable traffic.

A basic emergency-priority system reacts when an emergency vehicle reaches an intersection. ITMS instead predicts where the vehicle will be and what traffic will look like when it arrives, then prepares upcoming intersections in advance.

## 3. Product Vision

Build a closed-loop system:

Emergency detected → traffic predicted → route optimized → ETA calculated → green corridor planned → signals optimized → simulation updated → conditions re-evaluated → corridor re-optimized.

## 4. Target Users

### Primary
- Traffic control room operators
- Emergency traffic coordinators
- City mobility/transport planners

### Secondary
- Emergency response planners
- Traffic analysts
- Hackathon/demo evaluators

## 5. Core Features

### 5.1 Digital Traffic Twin
- Urban road network
- Intersections
- Lanes
- Traffic signals
- Normal vehicles
- Emergency vehicles
- Hospitals and emergency facilities

### 5.2 Real-Time Traffic Intelligence
Track:
- Vehicle count
- Average speed
- Traffic density
- Queue length
- Flow rate
- Signal state
- Congestion level

### 5.3 Emergency Management
Support:
- Ambulance
- Fire engine
- Police vehicle

Operators can create an emergency, choose origin/destination, assign priority, and monitor the vehicle.

### 5.4 Route Optimization
Use a graph-based route engine to select the fastest route based on current and predicted traffic rather than distance alone.

### 5.5 Traffic Prediction
Predict traffic conditions at 30, 60, 90, and 120 second horizons.

Initial ML model:
- XGBoost

### 5.6 Predictive Rolling Green Corridor
Coordinate multiple upcoming signals based on:
- Emergency ETA
- Route
- Predicted traffic
- Signal state
- Queue length
- Cross traffic
- Downstream capacity
- Safety constraints

### 5.7 Dynamic Signal Optimization
Signals are adjusted continuously rather than only once.

### 5.8 Simulation
Use SUMO + TraCI to:
- Run traffic
- Read traffic state
- Control signals
- Change routes
- Test emergency scenarios

### 5.9 Command Center
Provide:
- Live map
- Emergency panel
- Signal panel
- Corridor visualization
- Traffic KPIs
- AI decision trace
- Simulation controls

### 5.10 What-If Simulation
Allow users to select:
- Emergency type
- Origin
- Destination
- Traffic conditions
- Scenario mode

Then compare baseline vs ITMS.

### 5.11 Analytics
Measure:
- Emergency travel time
- Average response time
- Average delay
- Queue length
- Average speed
- Throughput
- Signal changes
- Corridor duration

## 6. Core User Flow

1. Operator opens Command Center.
2. Traffic simulation is running.
3. Emergency is created.
4. System identifies emergency location and destination.
5. Route engine calculates candidate routes.
6. Traffic prediction estimates future conditions.
7. Route engine selects a dynamic route.
8. ETA is calculated for upcoming intersections.
9. Green Corridor Engine creates a signal schedule.
10. Safety constraints validate the schedule.
11. Signal commands are sent to SUMO.
12. Emergency vehicle moves through the corridor.
13. Traffic is re-read.
14. ETA and corridor are recalculated.
15. Emergency reaches destination.
16. System stores and displays performance metrics.

## 7. Non-Functional Requirements

### Performance
- Real-time dashboard updates
- Low-latency simulation control
- Prediction inference should be fast enough for repeated re-planning

### Reliability
- Graceful fallback when ML prediction is unavailable
- Safe fallback when corridor optimization fails
- No undefined signal state

### Explainability
The system should show why a route/corridor decision was made.

### Security
- Environment variables for secrets
- Input validation
- API authentication if multi-user deployment is added
- No hard-coded credentials

## 8. MVP

The minimum complete product must include:
- SUMO network
- Traffic simulation
- Backend-to-SUMO connection
- Emergency vehicle
- Dynamic route
- Traffic prediction
- Green corridor
- Dynamic signals
- Live map
- Baseline vs ITMS comparison
- Performance metrics

## 9. Success Criteria

The project is successful when a live scenario can demonstrate:

Emergency → Prediction → Route → ETA → Green Corridor → Signal Control → Emergency Arrival → Measured Results.

Performance numbers must be generated from simulation data and not manually fabricated.

## 10. Future Scope

- CCTV/computer vision traffic detection
- IoT sensors
- Weather-aware prediction
- Accident detection
- Hospital availability
- V2X
- Connected vehicles
- Multi-emergency coordination
- Graph Neural Networks
- Reinforcement learning
- Real municipal traffic-controller integration
