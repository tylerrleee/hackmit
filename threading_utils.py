"""
Threading utilities for optimized AR camera processing
Provides thread-safe data structures and performance monitoring
"""

import threading
import queue
import time
import numpy as np
from collections import deque
from dataclasses import dataclass
from typing import Optional, Dict, Any, List
import statistics


@dataclass
class FrameData:
    """Container for frame data with metadata"""
    frame: np.ndarray
    timestamp: float
    frame_id: int
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


@dataclass
class ARProcessingResult:
    """Container for AR processing results"""
    frame_id: int
    timestamp: float
    processing_time: float
    ar_data: Dict[str, Any]
    tracking_results: Dict[str, Any] = None
    anchors: Dict[str, Any] = None
    overlay_data: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.tracking_results is None:
            self.tracking_results = {}
        if self.anchors is None:
            self.anchors = {}
        if self.overlay_data is None:
            self.overlay_data = {}


class CircularFrameBuffer:
    """Thread-safe circular buffer for frame data with automatic overflow handling"""
    
    def __init__(self, max_size=10):
        self.max_size = max_size
        self.buffer = deque(maxlen=max_size)
        self.lock = threading.RLock()
        self.not_empty = threading.Condition(self.lock)
        self.dropped_frames = 0
        
    def put(self, frame_data: FrameData, block=True, timeout=None):
        """Add frame data to buffer"""
        with self.not_empty:
            if len(self.buffer) == self.max_size:
                self.dropped_frames += 1
                # Remove oldest frame to make space
                self.buffer.popleft()
            
            self.buffer.append(frame_data)
            self.not_empty.notify()
            return True
    
    def get(self, block=True, timeout=None):
        """Get frame data from buffer"""
        with self.not_empty:
            while len(self.buffer) == 0:
                if not block:
                    raise queue.Empty()
                if not self.not_empty.wait(timeout):
                    raise queue.Empty()
            
            return self.buffer.popleft()
    
    def get_latest(self):
        """Get most recent frame without blocking"""
        with self.lock:
            if len(self.buffer) == 0:
                return None
            return self.buffer[-1]
    
    def clear(self):
        """Clear all frames from buffer"""
        with self.lock:
            self.buffer.clear()
            self.dropped_frames = 0
    
    def size(self):
        """Get current buffer size"""
        with self.lock:
            return len(self.buffer)
    
    def get_stats(self):
        """Get buffer statistics"""
        with self.lock:
            return {
                'current_size': len(self.buffer),
                'max_size': self.max_size,
                'dropped_frames': self.dropped_frames,
                'utilization': len(self.buffer) / self.max_size
            }


class ThreadSafeDict:
    """Thread-safe dictionary for sharing AR processing results"""
    
    def __init__(self):
        self.data = {}
        self.lock = threading.RLock()
    
    def __setitem__(self, key, value):
        with self.lock:
            self.data[key] = value
    
    def __getitem__(self, key):
        with self.lock:
            return self.data[key]
    
    def get(self, key, default=None):
        with self.lock:
            return self.data.get(key, default)
    
    def update(self, other_dict):
        with self.lock:
            self.data.update(other_dict)
    
    def keys(self):
        with self.lock:
            return list(self.data.keys())
    
    def values(self):
        with self.lock:
            return list(self.data.values())
    
    def items(self):
        with self.lock:
            return list(self.data.items())
    
    def clear(self):
        with self.lock:
            self.data.clear()
    
    def copy(self):
        with self.lock:
            return self.data.copy()


class PerformanceMonitor:
    """Monitor and track performance metrics across threads"""
    
    def __init__(self, window_size=100):
        self.window_size = window_size
        self.metrics = ThreadSafeDict()
        self.timers = ThreadSafeDict()
        self.lock = threading.RLock()
        
        # Initialize metric collections
        self._init_metrics()
    
    def _init_metrics(self):
        """Initialize metric collections"""
        metric_names = [
            'capture_fps', 'processing_fps', 'display_fps',
            'capture_time', 'processing_time', 'display_time',
            'total_latency', 'queue_sizes', 'memory_usage'
        ]
        
        for name in metric_names:
            self.metrics[name] = deque(maxlen=self.window_size)
    
    def start_timer(self, name: str):
        """Start a performance timer"""
        self.timers[name] = time.perf_counter()
    
    def end_timer(self, name: str) -> float:
        """End a performance timer and record the duration"""
        if name not in self.timers.data:
            return 0.0
        
        duration = time.perf_counter() - self.timers[name]
        self.record_metric(f"{name}_time", duration)
        return duration
    
    def record_metric(self, name: str, value: float):
        """Record a metric value"""
        if name not in self.metrics.data:
            self.metrics[name] = deque(maxlen=self.window_size)
        
        self.metrics[name].append(value)
    
    def record_fps(self, name: str):
        """Record FPS for a given operation"""
        current_time = time.time()
        fps_key = f"{name}_fps_timestamps"
        
        if fps_key not in self.metrics.data:
            self.metrics[fps_key] = deque(maxlen=30)  # Track last 30 timestamps
        
        self.metrics[fps_key].append(current_time)
        
        # Calculate FPS from recent timestamps
        timestamps = list(self.metrics[fps_key])
        if len(timestamps) >= 2:
            time_span = timestamps[-1] - timestamps[0]
            if time_span > 0:
                fps = (len(timestamps) - 1) / time_span
                self.record_metric(f"{name}_fps", fps)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get comprehensive performance statistics"""
        stats = {}
        
        with self.lock:
            for name, values in self.metrics.items():
                if len(values) == 0:
                    continue
                
                values_list = list(values)
                stats[name] = {
                    'current': values_list[-1] if values_list else 0,
                    'average': statistics.mean(values_list),
                    'min': min(values_list),
                    'max': max(values_list),
                    'count': len(values_list)
                }
                
                if len(values_list) > 1:
                    stats[name]['std_dev'] = statistics.stdev(values_list)
        
        return stats
    
    def get_summary(self) -> str:
        """Get a formatted summary of current performance"""
        stats = self.get_stats()
        summary_lines = ["Performance Summary:"]
        
        # FPS metrics
        fps_metrics = [k for k in stats.keys() if k.endswith('_fps')]
        if fps_metrics:
            summary_lines.append("  FPS Metrics:")
            for metric in fps_metrics:
                if metric in stats:
                    current = stats[metric]['current']
                    avg = stats[metric]['average']
                    summary_lines.append(f"    {metric}: {current:.1f} (avg: {avg:.1f})")
        
        # Timing metrics
        time_metrics = [k for k in stats.keys() if k.endswith('_time')]
        if time_metrics:
            summary_lines.append("  Timing Metrics (ms):")
            for metric in time_metrics:
                if metric in stats:
                    current = stats[metric]['current'] * 1000
                    avg = stats[metric]['average'] * 1000
                    summary_lines.append(f"    {metric}: {current:.2f} (avg: {avg:.2f})")
        
        return "\n".join(summary_lines)
    
    def reset(self):
        """Reset all metrics"""
        with self.lock:
            for name in self.metrics.keys():
                self.metrics[name].clear()
            self.timers.clear()


class AdaptiveFrameProcessor:
    """Adaptive frame processing to maintain target FPS"""
    
    def __init__(self, target_fps=30, quality_levels=None):
        self.target_fps = target_fps
        self.target_frame_time = 1.0 / target_fps
        
        if quality_levels is None:
            quality_levels = [
                {'scale': 1.0, 'quality': 'high'},
                {'scale': 0.8, 'quality': 'medium'},
                {'scale': 0.6, 'quality': 'low'},
                {'scale': 0.4, 'quality': 'very_low'}
            ]
        
        self.quality_levels = quality_levels
        self.current_level = 0
        self.performance_history = deque(maxlen=10)
        self.lock = threading.Lock()
        
    def should_process_frame(self, current_time: float, last_process_time: float) -> bool:
        """Determine if frame should be processed based on target FPS"""
        return (current_time - last_process_time) >= self.target_frame_time
    
    def adapt_quality(self, processing_time: float) -> Dict[str, Any]:
        """Adapt processing quality based on performance"""
        with self.lock:
            self.performance_history.append(processing_time)
            
            if len(self.performance_history) < 5:
                return self.quality_levels[self.current_level]
            
            avg_time = statistics.mean(self.performance_history)
            
            # Adjust quality level based on performance
            if avg_time > self.target_frame_time * 1.5 and self.current_level < len(self.quality_levels) - 1:
                # Performance too slow, reduce quality
                self.current_level += 1
            elif avg_time < self.target_frame_time * 0.7 and self.current_level > 0:
                # Performance good, increase quality
                self.current_level -= 1
            
            return self.quality_levels[self.current_level]
    
    def get_current_settings(self) -> Dict[str, Any]:
        """Get current quality settings"""
        with self.lock:
            return {
                **self.quality_levels[self.current_level],
                'level': self.current_level,
                'target_fps': self.target_fps,
                'avg_processing_time': statistics.mean(self.performance_history) if self.performance_history else 0
            }


class ThreadCoordinator:
    """Coordinates communication between processing threads"""
    
    def __init__(self):
        self.shutdown_event = threading.Event()
        self.pause_event = threading.Event()
        self.thread_status = ThreadSafeDict()
        self.error_queue = queue.Queue()
        
        # Initialize thread status
        thread_names = ['capture', 'processing', 'display', 'background']
        for name in thread_names:
            self.thread_status[name] = {
                'active': False,
                'last_heartbeat': time.time(),
                'error_count': 0
            }
    
    def signal_shutdown(self):
        """Signal all threads to shutdown"""
        self.shutdown_event.set()
    
    def is_shutdown_requested(self) -> bool:
        """Check if shutdown has been requested"""
        return self.shutdown_event.is_set()
    
    def pause(self):
        """Pause all processing"""
        self.pause_event.set()
    
    def resume(self):
        """Resume all processing"""
        self.pause_event.clear()
    
    def is_paused(self) -> bool:
        """Check if processing is paused"""
        return self.pause_event.is_set()
    
    def heartbeat(self, thread_name: str):
        """Record thread heartbeat"""
        if thread_name in self.thread_status.data:
            self.thread_status[thread_name] = {
                **self.thread_status[thread_name],
                'active': True,
                'last_heartbeat': time.time()
            }
        else:
            # Initialize new thread status
            self.thread_status[thread_name] = {
                'active': True,
                'last_heartbeat': time.time(),
                'error_count': 0
            }
    
    def report_error(self, thread_name: str, error: Exception):
        """Report thread error"""
        self.error_queue.put((thread_name, error, time.time()))
        
        if thread_name in self.thread_status.data:
            status = self.thread_status[thread_name]
            status['error_count'] += 1
            self.thread_status[thread_name] = status
    
    def get_errors(self) -> List[tuple]:
        """Get all pending errors"""
        errors = []
        while not self.error_queue.empty():
            try:
                errors.append(self.error_queue.get_nowait())
            except queue.Empty:
                break
        return errors
    
    def get_thread_health(self) -> Dict[str, Any]:
        """Get health status of all threads"""
        current_time = time.time()
        health = {}
        
        for thread_name, status in self.thread_status.items():
            time_since_heartbeat = current_time - status['last_heartbeat']
            health[thread_name] = {
                'active': status['active'],
                'responsive': time_since_heartbeat < 5.0,  # 5 second threshold
                'error_count': status['error_count'],
                'last_seen': time_since_heartbeat
            }
        
        return health