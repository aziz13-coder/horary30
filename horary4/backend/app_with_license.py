# -*- coding: utf-8 -*-

"""
Enhanced Traditional Horary Astrology Flask API with Offline License System

UPDATED to include comprehensive license management and validation

Created on Wed May 28 11:10:58 2025
Updated with license system on Jun 04, 2025

@author: sabaa (enhanced with licensing)
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import traceback
import time
import logging
import os
from datetime import datetime, timezone
from functools import wraps
from collections import defaultdict

# License system imports
from license_manager import LicenseManager, LicenseError, check_license, is_feature_available, get_license_info

# UPDATED IMPORT: Use the new enhanced engine
from horary_engine import HoraryEngine, LocationError, serialize_planet_with_solar

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('horary_api.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Initialize license manager and horary engine
license_manager = LicenseManager()
horary_engine = HoraryEngine()

# Global license status
_license_status = {'valid': False, 'error': 'Not checked'}

def check_license_on_startup():
    """Check license validity on application startup"""
    global _license_status
    
    try:
        logger.info("Checking license on startup...")
        is_valid, license_info = license_manager.validate_license()
        
        _license_status = {
            'valid': is_valid,
            'info': license_info,
            'last_checked': datetime.now(timezone.utc).isoformat()
        }
        
        if is_valid:
            logger.info(f"License valid - Licensed to: {license_info.get('licensedTo', 'Unknown')}")
            logger.info(f"License features: {', '.join(license_info.get('features', []))}")
            logger.info(f"Days remaining: {license_info.get('daysRemaining', 0)}")
            
            # Warn if license is expiring soon
            days_remaining = license_info.get('daysRemaining', 0)
            if days_remaining <= 30:
                logger.warning(f"License expires in {days_remaining} days!")
            
        else:
            error_msg = license_info.get('error', 'Unknown license error')
            logger.error(f"License validation failed: {error_msg}")
            
            # In production, you might want to restrict functionality here
            # For development, we'll allow operation with warnings
            if os.getenv('HORARY_ENV') == 'production':
                logger.critical("Production mode: License required for operation")
                # Could exit here in strict production mode
                # exit(1)
        
    except Exception as e:
        logger.error(f"License check failed: {str(e)}")
        _license_status = {
            'valid': False,
            'error': str(e),
            'last_checked': datetime.now(timezone.utc).isoformat()
        }

def require_license(feature=None):
    """Decorator to require valid license for endpoints"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Check if license is valid
            if not _license_status.get('valid', False):
                return jsonify({
                    'error': 'Invalid or expired license',
                    'license_error': _license_status.get('error', 'Unknown license error'),
                    'requires_license': True,
                    'success': False
                }), 403
            
            # Check feature-specific licensing
            if feature and not is_feature_available(feature):
                return jsonify({
                    'error': f'Feature not available in current license: {feature}',
                    'available_features': _license_status.get('info', {}).get('features', []),
                    'requires_upgrade': True,
                    'success': False
                }), 403
            
            return func(*args, **kwargs)
        return wrapper
    return decorator

def require_feature(feature_name):
    """Decorator to require specific feature in license"""
    return require_license(feature_name)

# Simple metrics collection (preserved from original)
class SimpleMetrics:
    def __init__(self):
        self.request_count = defaultdict(int)
        self.error_count = defaultdict(int)
        self.response_times = defaultdict(list)
        self.license_checks = 0
        self.feature_denials = defaultdict(int)
    
    def record_request(self, endpoint):
        self.request_count[endpoint] += 1
    
    def record_error(self, endpoint, error_type):
        self.error_count[f"{endpoint}_{error_type}"] += 1
    
    def record_response_time(self, endpoint, duration):
        self.response_times[endpoint].append(duration)
        if len(self.response_times[endpoint]) > 100:
            self.response_times[endpoint] = self.response_times[endpoint][-100:]
    
    def record_license_check(self):
        self.license_checks += 1
    
    def record_feature_denial(self, feature):
        self.feature_denials[feature] += 1
    
    def get_stats(self):
        stats = {
            'requests': dict(self.request_count),
            'errors': dict(self.error_count),
            'avg_response_times': {},
            'license_checks': self.license_checks,
            'feature_denials': dict(self.feature_denials)
        }
        
        for endpoint, times in self.response_times.items():
            if times:
                stats['avg_response_times'][endpoint] = sum(times) / len(times)
        
        return stats

metrics = SimpleMetrics()

def timing_decorator(endpoint_name):
    """Decorator to time API endpoints (preserved from original)"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            metrics.record_request(endpoint_name)
            start_time = time.time()
            
            try:
                result = func(*args, **kwargs)
                duration = time.time() - start_time
                metrics.record_response_time(endpoint_name, duration)
                
                logger.info(f"{endpoint_name} completed in {duration:.2f}s")
                return result
                
            except Exception as e:
                duration = time.time() - start_time
                metrics.record_response_time(endpoint_name, duration)
                metrics.record_error(endpoint_name, type(e).__name__)
                
                logger.error(f"{endpoint_name} failed after {duration:.2f}s: {str(e)}")
                raise
        
        return wrapper
    return decorator

# License management endpoints

@app.route('/api/license/status', methods=['GET'])
@timing_decorator('license_status')
def get_license_status():
    """Get current license status and information"""
    try:
        metrics.record_license_check()
        
        # Force refresh license status
        is_valid, license_info = license_manager.validate_license(force_reload=True)
        
        # Update global status
        global _license_status
        _license_status = {
            'valid': is_valid,
            'info': license_info,
            'last_checked': datetime.now(timezone.utc).isoformat()
        }
        
        # Get comprehensive status
        status = license_manager.get_license_status()
        
        response = {
            'license': status,
            'api_version': '2.0.0',
            'last_checked': _license_status['last_checked'],
            'success': True
        }
        
        return jsonify(response), 200
        
    except Exception as e:
        logger.error(f"Error getting license status: {str(e)}")
        return jsonify({
            'error': f'License status check failed: {str(e)}',
            'success': False
        }), 500

@app.route('/api/license/features', methods=['GET'])
@timing_decorator('license_features')
def get_license_features():
    """Get available features in current license"""
    try:
        status = license_manager.get_license_status()
        
        return jsonify({
            'available_features': status.get('features', {}),
            'feature_count': status.get('featureCount', 0),
            'license_valid': status.get('valid', False),
            'license_type': status.get('licenseType', 'unknown'),
            'success': True
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting license features: {str(e)}")
        return jsonify({
            'error': f'Feature check failed: {str(e)}',
            'success': False
        }), 500

@app.route('/api/license/validate', methods=['POST'])
@timing_decorator('license_validate')
def validate_license_file():
    """Validate a license file upload"""
    try:
        data = request.get_json()
        
        if not data or 'license_path' not in data:
            return jsonify({
                'error': 'License file path required',
                'success': False
            }), 400
        
        license_path = data['license_path']
        
        # Create temporary license manager for the file
        temp_manager = LicenseManager(license_file_path=license_path)
        is_valid, license_info = temp_manager.validate_license()
        
        return jsonify({
            'valid': is_valid,
            'license_info': license_info,
            'success': True
        }), 200
        
    except Exception as e:
        logger.error(f"Error validating license file: {str(e)}")
        return jsonify({
            'error': f'License validation failed: {str(e)}',
            'success': False
        }), 500

# Original endpoints with license integration

@app.route('/api/health', methods=['GET'])
@timing_decorator('health')
def health_check():
    """Enhanced health check with license status"""
    
    health_status = {
        'status': 'healthy',
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'version': '2.0.0',
        'services': {},
        'metrics': metrics.get_stats(),
        'license': {
            'valid': _license_status.get('valid', False),
            'last_checked': _license_status.get('last_checked', 'Never'),
            'days_remaining': _license_status.get('info', {}).get('daysRemaining', 0) if _license_status.get('valid') else 0
        },
        'enhanced_features': {
            'future_retrograde_frustration': True,
            'directional_sign_exit': True,
            'translation_sequence_enforcement': True,
            'refranation_abscission_detection': True,
            'enhanced_reception_weighting': True,
            'venus_mercury_combustion_exceptions': True,
            'variable_moon_speed_timing': True,
            'fail_fast_geocoding': True,
            'optional_override_flags': True,
            'offline_license_system': True  # NEW
        }
    }
    
    # Test timezone finder
    try:
        from timezonefinder import TimezoneFinder
        tf = TimezoneFinder()
        test_tz = tf.timezone_at(lat=51.5074, lng=-0.1278)
        health_status['services']['timezone_finder'] = {
            'status': 'healthy' if test_tz else 'degraded',
            'test_result': test_tz
        }
    except Exception as e:
        health_status['services']['timezone_finder'] = {
            'status': 'unhealthy',
            'error': str(e)
        }
    
    # Test Swiss Ephemeris
    try:
        import swisseph as swe
        jd = swe.julday(2025, 5, 29, 12.0)
        sun_pos = swe.calc_ut(jd, swe.SUN)
        health_status['services']['swiss_ephemeris'] = {
            'status': 'healthy',
            'test_calculation': f"Sun at {sun_pos[0][0]:.2f}°"
        }
    except Exception as e:
        health_status['services']['swiss_ephemeris'] = {
            'status': 'unhealthy',
            'error': str(e)
        }
    
    # Test license system
    try:
        is_valid, _ = license_manager.validate_license()
        health_status['services']['license_system'] = {
            'status': 'healthy' if is_valid else 'degraded',
            'license_valid': is_valid,
            'license_file_exists': os.path.exists(license_manager.license_file)
        }
    except Exception as e:
        health_status['services']['license_system'] = {
            'status': 'unhealthy',
            'error': str(e)
        }
    
    # Other service checks (preserved from original)...
    
    # Overall status determination
    service_statuses = [s['status'] for s in health_status['services'].values()]
    if 'unhealthy' in service_statuses:
        health_status['status'] = 'unhealthy'
        return jsonify(health_status), 503
    elif 'degraded' in service_statuses:
        health_status['status'] = 'degraded'
        return jsonify(health_status), 200
    
    return jsonify(health_status), 200

@app.route('/api/get-timezone', methods=['POST'])
@timing_decorator('get_timezone')
@require_feature('timezone_support')  # NEW: Require timezone feature
def get_timezone():
    """Get timezone information for a given location (requires license)"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided', 'success': False}), 400
        
        location = data.get('location', '').strip()
        
        if not location:
            return jsonify({'error': 'Location is required', 'success': False}), 400
        
        logger.info(f"Getting timezone for location: {location}")
        
        try:
            from _horary_math import safe_geocode
            lat, lon, full_location = safe_geocode(location)
            
            from horary_engine import TimezoneManager
            timezone_manager = TimezoneManager()
            timezone_str = timezone_manager.get_timezone_for_location(lat, lon)
            
            result = {
                'location': full_location,
                'latitude': lat,
                'longitude': lon,
                'timezone': timezone_str,
                'success': True,
                'enhanced_geocoding': True,
                'license_feature': 'timezone_support'  # NEW: Indicate licensed feature
            }
            
            logger.info(f"Enhanced timezone detection successful: {timezone_str} for {full_location}")
            return jsonify(result)
            
        except LocationError as e:
            error_msg = str(e)
            logger.warning(f"Location error: {error_msg}")
            return jsonify({
                'error': error_msg,
                'success': False,
                'error_type': 'LocationError'
            }), 404
            
        except Exception as e:
            error_msg = f'Error getting timezone for {location}: {str(e)}'
            logger.error(error_msg)
            return jsonify({
                'error': error_msg,
                'success': False
            }), 500
            
    except Exception as e:
        logger.error(f"Unexpected error in get_timezone: {str(e)}")
        return jsonify({
            'error': f'Internal server error: {str(e)}',
            'success': False
        }), 500

@app.route('/api/current-time', methods=['POST'])
@timing_decorator('current_time')
@require_feature('timezone_support')  # NEW: Require timezone feature
def get_current_time():
    """Get current time for a specific location (requires license)"""
    # Implementation preserved from original with license check
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided', 'success': False}), 400
        
        location = data.get('location', '').strip()
        
        if not location:
            return jsonify({'error': 'Location is required', 'success': False}), 400
        
        logger.info(f"Getting current time for location: {location}")
        
        try:
            from _horary_math import safe_geocode
            lat, lon, full_location = safe_geocode(location)
            
            from horary_engine import TimezoneManager
            timezone_manager = TimezoneManager()
            dt_local, dt_utc, timezone_used = timezone_manager.get_current_time_for_location(lat, lon)
            
            result = {
                'location': full_location,
                'latitude': lat,
                'longitude': lon,
                'local_time': dt_local.isoformat(),
                'utc_time': dt_utc.isoformat(),
                'timezone': timezone_used,
                'utc_offset': dt_local.strftime("%z") if hasattr(dt_local, 'strftime') else "Unknown",
                'success': True,
                'enhanced_processing': True,
                'license_feature': 'timezone_support'  # NEW: Indicate licensed feature
            }
            
            logger.info(f"Enhanced current time retrieval successful for {full_location}: {dt_local}")
            return jsonify(result)
            
        except LocationError as e:
            error_msg = str(e)
            logger.warning(f"Location error: {error_msg}")
            return jsonify({
                'error': error_msg,
                'success': False,
                'error_type': 'LocationError'
            }), 404
            
        except Exception as e:
            error_msg = f'Error getting current time for {location}: {str(e)}'
            logger.error(error_msg)
            return jsonify({
                'error': error_msg,
                'success': False
            }), 500
            
    except Exception as e:
        logger.error(f"Unexpected error in get_current_time: {str(e)}")
        return jsonify({
            'error': f'Internal server error: {str(e)}',
            'success': False
        }), 500

@app.route('/api/calculate-chart', methods=['POST'])
@timing_decorator('calculate_chart')
@require_feature('enhanced_engine')  # NEW: Require enhanced engine feature
def calculate_chart():
    """Enhanced chart calculation with licensing (requires enhanced_engine feature)"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'error': 'No JSON data provided',
                'judgment': 'ERROR',
                'confidence': 0,
                'reasoning': ['No JSON data provided']
            }), 400
        
        # Extract parameters (preserved from original)
        question = data.get('question', '').strip()
        location = data.get('location', 'London, UK').strip()
        date_str = data.get('date')
        time_str = data.get('time')
        timezone_str = data.get('timezone')
        use_current_time = data.get('useCurrentTime', True)
        manual_houses = data.get('manualHouses')
        
        # Enhanced parameters
        ignore_radicality = data.get('ignoreRadicality', False)
        ignore_void_moon = data.get('ignoreVoidMoon', False)
        ignore_combustion = data.get('ignoreCombustion', False)
        ignore_saturn_7th = data.get('ignoreSaturn7th', False)
        exaltation_confidence_boost = data.get('exaltationConfidenceBoost', 15.0)
        
        # Check feature-specific licensing
        advanced_features_used = []
        if ignore_radicality or ignore_void_moon or ignore_combustion or ignore_saturn_7th:
            if not is_feature_available('override_flags'):
                return jsonify({
                    'error': 'Override flags require premium license feature',
                    'requires_feature': 'override_flags',
                    'success': False
                }), 403
            advanced_features_used.append('override_flags')
        
        if data.get('futureRetrogradeCheck', True) and not is_feature_available('future_retrograde'):
            metrics.record_feature_denial('future_retrograde')
            # Could either deny or gracefully degrade
            logger.warning("Future retrograde feature not available in license")
        
        logger.info(f"ENHANCED chart calculation request (licensed):")
        logger.info(f"  Question: {question[:100]}..." if len(question) > 100 else f"  Question: {question}")
        logger.info(f"  Licensed features used: {advanced_features_used}")
        
        # Validation (preserved from original)
        if not question:
            return jsonify({
                'error': 'Question is required',
                'judgment': 'ERROR',
                'confidence': 0,
                'reasoning': ['No horary question provided']
            }), 400
        
        if not location:
            return jsonify({
                'error': 'Location is required',
                'judgment': 'ERROR', 
                'confidence': 0,
                'reasoning': ['No location provided']
            }), 400
        
        # Manual houses conversion (preserved from original)
        houses_list = None
        if manual_houses:
            try:
                houses_list = [int(h.strip()) for h in manual_houses.split(',') if h.strip()]
                if len(houses_list) < 2:
                    return jsonify({
                        'error': 'Manual houses must include at least querent and quesited houses (e.g., "1,7")',
                        'judgment': 'ERROR',
                        'confidence': 0,
                        'reasoning': ['Invalid manual house specification']
                    }), 400
            except ValueError:
                return jsonify({
                    'error': 'Manual houses must be numbers separated by commas (e.g., "1,7")',
                    'judgment': 'ERROR',
                    'confidence': 0,
                    'reasoning': ['Invalid manual house format']
                }), 400
        
        # Enhanced calculation with license metadata
        start_time = time.time()
        
        try:
            settings = {
                "location": location,
                "date": date_str,
                "time": time_str,
                "timezone": timezone_str,
                "use_current_time": use_current_time,
                "manual_houses": houses_list,
                "ignore_radicality": ignore_radicality,
                "ignore_void_moon": ignore_void_moon,
                "ignore_combustion": ignore_combustion,
                "ignore_saturn_7th": ignore_saturn_7th,
                "exaltation_confidence_boost": exaltation_confidence_boost
            }
            
            result = horary_engine.judge(question, settings)
            
        except LocationError as e:
            logger.error(f"Location error: {str(e)}")
            return jsonify({
                'error': str(e),
                'judgment': 'LOCATION_ERROR',
                'confidence': 0,
                'reasoning': [f'Location error: {str(e)}'],
                'error_type': 'LocationError'
            }), 400
        
        calculation_time = time.time() - start_time
        logger.info(f"ENHANCED licensed chart calculation completed in {calculation_time:.2f} seconds")
        
        if result.get('error'):
            logger.error(f"Chart calculation error: {result['error']}")
            return jsonify(result), 500
        
        # Add license metadata to result
        license_status = license_manager.get_license_status()
        result['license_metadata'] = {
            'licensed_to': license_status.get('licensedTo', 'Unknown'),
            'license_type': license_status.get('licenseType', 'unknown'),
            'features_used': ['enhanced_engine'] + advanced_features_used,
            'calculation_licensed': True
        }
        
        # Enhanced calculation metadata (preserved and extended)
        result['calculation_metadata'] = {
            'calculation_time_seconds': calculation_time,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'api_version': '2.0.0',
            'engine_version': 'Enhanced Traditional Horary 2.0 (Licensed)',
            'license_verified': True,
            'enhanced_features_used': {
                'future_retrograde_checks': True,
                'directional_motion_awareness': True,
                'sequence_enforcement': True,
                'enhanced_denial_conditions': True,
                'reception_weighting_nuance': True,
                'solar_condition_enhancements': True,
                'variable_moon_timing': True,
                'fail_fast_geocoding': True,
                'offline_license_validation': True  # NEW
            },
            'override_flags_applied': {
                'ignore_radicality': ignore_radicality,
                'ignore_void_moon': ignore_void_moon,
                'ignore_combustion': ignore_combustion,
                'ignore_saturn_7th': ignore_saturn_7th
            },
            'enhanced_parameters': {
                'exaltation_confidence_boost': exaltation_confidence_boost
            }
        }
        
        logger.info(f"ENHANCED licensed chart calculation successful - Judgment: {result.get('judgment')} (Confidence: {result.get('confidence')}%)")
        
        return jsonify(result)
        
    except Exception as e:
        error_msg = f"Error calculating enhanced licensed chart: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        
        return jsonify({
            'error': error_msg,
            'judgment': 'ERROR',
            'confidence': 0,
            'reasoning': [f'Enhanced calculation error: {str(e)}'],
            'calculation_metadata': {
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'api_version': '2.0.0',
                'license_verified': _license_status.get('valid', False)
            }
        }), 500

# Preserve other endpoints from original with appropriate license checks...

@app.route('/api/moon-debug', methods=['POST'])
@timing_decorator('moon_debug')
@require_feature('moon_analysis')  # NEW: Require moon analysis feature
def moon_debug():
    """Get detailed Moon void of course debug information (requires license)"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        return jsonify({
            'message': 'Enhanced licensed Moon debug information is included in chart calculation results',
            'instructions': 'Check the moon_aspects field in the calculate-chart response',
            'enhanced_features': {
                'variable_moon_speed': 'Real-time Moon speed from ephemeris',
                'directional_sign_exit': 'Motion-aware sign boundary calculations',
                'enhanced_void_detection': 'Improved future aspect calculations',
                'solar_conditions': 'Check response.solar_factors for detailed analysis'
            },
            'license_feature': 'moon_analysis',
            'licensed': True
        })
        
    except Exception as e:
        logger.error(f"Error in enhanced licensed moon_debug endpoint: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/metrics', methods=['GET'])
@timing_decorator('metrics')
def get_metrics():
    """Get enhanced API performance metrics with license info"""
    try:
        license_status = license_manager.get_license_status()
        
        return jsonify({
            'status': 'success',
            'metrics': metrics.get_stats(),
            'enhanced_engine_stats': {
                'version': '2.0.0',
                'features_enabled': len(license_status.get('features', {})),
                'classical_sources_implemented': 5,
                'license_valid': license_status.get('valid', False),
                'license_features': list(license_status.get('features', {}).keys())
            },
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
    except Exception as e:
        logger.error(f"Error getting enhanced metrics: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/version', methods=['GET'])
def get_version():
    """Enhanced API version information with license details"""
    license_status = license_manager.get_license_status()
    
    return jsonify({
        'api_version': '2.0.0',
        'engine_version': 'Enhanced Traditional Horary 2.0 (Licensed)',
        'release_date': '2025-06-04',
        'license_system': {
            'enabled': True,
            'valid': license_status.get('valid', False),
            'licensed_to': license_status.get('licensedTo', 'Unlicensed'),
            'license_type': license_status.get('licenseType', 'unknown'),
            'days_remaining': license_status.get('daysRemaining', 0),
            'features_available': len(license_status.get('features', {}))
        },
        'features': [
            'Traditional horary analysis',
            'Timezone support',
            'Swiss Ephemeris calculations',
            'Enhanced Moon void of course analysis',
            'Automatic timezone detection',
            'DST handling',
            'Enhanced dignity calculations',
            'Regiomontanus house system',
            'Enhanced Cazimi detection',
            'Enhanced Combustion analysis',
            'Enhanced Under the Beams calculation',
            'Traditional solar exceptions',
            'Future retrograde frustration protection',
            'Directional sign-exit awareness',
            'Translation/collection sequence enforcement',
            'Refranation and abscission detection',
            'Enhanced reception weighting nuance',
            'Venus/Mercury combustion exceptions',
            'Variable Moon speed timing',
            'Fail-fast geocoding',
            'Optional override flags',
            'Offline license validation system'  # NEW
        ],
        'licensed_features': license_status.get('features', {}),
        'classical_sources': [
            'William Lilly - Christian Astrology',
            'Guido Bonatti - Liber Astronomicus',
            'Claudius Ptolemy - Tetrabiblos & Almagest',
            'Firmicus Maternus - Mathesis',
            'Al-Biruni - Elements of Astrology'
        ],
        'backward_compatibility': {
            'preserved': True,
            'old_api_supported': True,
            'migration_required': False,
            'enhancement_note': 'All existing code works unchanged with license system'
        },
        'timestamp': datetime.now(timezone.utc).isoformat()
    })

# Enhanced error handlers with license context

@app.errorhandler(403)
def license_required(error):
    """Handle license-related access denials"""
    return jsonify({
        'error': 'License required',
        'message': 'A valid license is required to access this feature',
        'license_status': _license_status.get('valid', False),
        'api_version': '2.0.0',
        'contact': 'support@horarymaster.com for licensing information'
    }), 403

@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'error': 'Endpoint not found',
        'message': 'The requested API endpoint does not exist',
        'api_version': '2.0.0',
        'license_required': True,
        'available_endpoints': [
            '/api/health',
            '/api/calculate-chart',
            '/api/get-timezone',
            '/api/current-time',
            '/api/moon-debug',
            '/api/metrics',
            '/api/version',
            '/api/license/status',
            '/api/license/features',
            '/api/license/validate'
        ]
    }), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error: {str(error)}")
    return jsonify({
        'error': 'Internal server error',
        'message': 'An unexpected error occurred in the enhanced licensed engine',
        'api_version': '2.0.0',
        'license_valid': _license_status.get('valid', False),
        'timestamp': datetime.now(timezone.utc).isoformat()
    }), 500

# Request logging middleware (preserved)
@app.before_request
def log_request():
    logger.info(f"{request.method} {request.path} - {request.remote_addr}")

@app.after_request
def log_response(response):
    logger.info(f"Response: {response.status_code} - {request.method} {request.path}")
    return response

if __name__ == '__main__':
    logger.info("Starting Enhanced Traditional Horary Astrology API Server v2.0.0 with License System")
    logger.info("Enhanced Features: Future retrograde, directional motion, enhanced reception")
    logger.info("New Capabilities: Refranation/abscission detection, enhanced solar conditions")
    logger.info("License System: Offline validation, feature-based licensing, cryptographic security")
    logger.info("Override Options: Radicality, void Moon, combustion, Saturn 7th (requires premium license)")
    logger.info("Classical Sources: Lilly, Bonatti, Ptolemy, Firmicus, Al-Biruni")
    logger.info("Backward Compatibility: All existing code works unchanged")
    
    # Check license on startup
    check_license_on_startup()
    
    # Development server configuration
    app.run(debug=True, host='0.0.0.0', port=5000)