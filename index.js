// Importa as bibliotecas
require('dotenv').config();
const express = require('express');
const { Client } = require('@googlemaps/google-maps-services-js');
const polyline = require('@mapbox/polyline');

// Instancia o cliente do Express e do Google Maps
const app = express();
app.use(express.json()); // Habilita o parsing de JSON no corpo das requisições
const mapsClient = new Client({});

// --- Funções Auxiliares de Geometria ---
// Precisamos recriar a matemática que a biblioteca de utilitários do Android fazia.

/**
 * Calcula a distância entre dois pontos usando a fórmula de Haversine.
 * @returns {number} Distância em metros.
 */
function getDistance(point1, point2) {
    const R = 6371e3; // Raio da Terra em metros
    const lat1 = point1.lat * Math.PI / 180;
    const lat2 = point2.lat * Math.PI / 180;
    const deltaLat = (point2.lat - point1.lat) * Math.PI / 180;
    const deltaLon = (point2.lng - point1.lng) * Math.PI / 180;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// --- O Endpoint Principal da API ---

app.post('/simulate-route', async (req, res) => {
    const { origin, destination, speedKmh } = req.body;

    if (!origin || !destination || !speedKmh) {
        return res.status(400).json({ error: 'Parâmetros origin, destination, e speedKmh são obrigatórios.' });
    }

    const speedMps = (speedKmh * 1000) / 3600; // Converte km/h para m/s

    try {
        // 1. Obter a rota da API do Google
        const directionsResponse = await mapsClient.directions({
            params: {
                origin: origin,
                destination: destination,
                key: process.env.Maps_API_KEY,
            },
        });

        if (directionsResponse.data.routes.length === 0) {
            return res.status(404).json({ error: 'Nenhuma rota encontrada.' });
        }

        const encodedPolyline = directionsResponse.data.routes[0].overview_polyline.points;

        // 2. Decodificar a polyline para uma lista de pontos [lat, lng]
        const decodedPath = polyline.decode(encodedPolyline).map(p => ({ lat: p[0], lng: p[1] }));

        // 3. Gerar os passos da simulação
        const simulationSteps = [];
        let elapsedTimeSeconds = 0;

        for (let i = 0; i < decodedPath.length - 1; i++) {
            const startPoint = decodedPath[i];
            const endPoint = decodedPath[i + 1];

            const segmentDistance = getDistance(startPoint, endPoint);
            const segmentDuration = segmentDistance / speedMps;

            // Gera um ponto a cada segundo para este segmento
            const stepsInSegment = Math.round(segmentDuration);
            for (let j = 0; j < stepsInSegment; j++) {
                const fraction = j / stepsInSegment;
                const currentLat = startPoint.lat + (endPoint.lat - startPoint.lat) * fraction;
                const currentLng = startPoint.lng + (endPoint.lng - startPoint.lng) * fraction;
                
                simulationSteps.push({
                    lat: currentLat,
                    lng: currentLng,
                    // Timestamp relativo em milissegundos desde o início da viagem
                    timestamp: Math.round(elapsedTimeSeconds * 1000) 
                });
                elapsedTimeSeconds++;
            }
        }
        
        // Adiciona o ponto final para garantir que a rota termine exatamente no destino
        const lastPoint = decodedPath[decodedPath.length - 1];
        simulationSteps.push({
            lat: lastPoint.lat,
            lng: lastPoint.lng,
            timestamp: Math.round(elapsedTimeSeconds * 1000)
        });

        // 4. Enviar a jornada completa para o cliente
        res.json({
            totalDurationSeconds: elapsedTimeSeconds,
            steps: simulationSteps,
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ocorreu um erro ao processar a rota.' });
    }
});


// --- Iniciar o Servidor ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor de simulação de GPS rodando na porta ${PORT}`);
});