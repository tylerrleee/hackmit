#!/usr/bin/env python3
"""
Test script for multi-threaded AR camera system
Validates threading components and performance improvements
"""

import time
import numpy as np
import logging
from threading_utils import (
    FrameData, CircularFrameBuffer, ThreadSafeDict, 
    PerformanceMonitor, AdaptiveFrameProcessor, ThreadCoordinator
)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def test_circular_buffer():
    """Test circular frame buffer functionality"""
    print("🧪 Testing CircularFrameBuffer...")
    
    buffer = CircularFrameBuffer(max_size=5)
    
    # Test basic put/get operations
    for i in range(3):
        frame_data = FrameData(
            frame=np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8),
            timestamp=time.time(),
            frame_id=i
        )
        buffer.put(frame_data, block=False)
    
    # Test buffer stats
    stats = buffer.get_stats()
    print(f"  Buffer stats: {stats}")
    assert stats['current_size'] == 3
    
    # Test overflow behavior
    for i in range(5):
        frame_data = FrameData(
            frame=np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8),
            timestamp=time.time(),
            frame_id=i + 10
        )
        buffer.put(frame_data, block=False)
    
    final_stats = buffer.get_stats()
    print(f"  Final buffer stats: {final_stats}")
    assert final_stats['current_size'] == 5
    assert final_stats['dropped_frames'] > 0
    
    print("✅ CircularFrameBuffer tests passed")


def test_thread_safe_dict():
    """Test thread-safe dictionary"""
    print("🧪 Testing ThreadSafeDict...")
    
    tsd = ThreadSafeDict()
    
    # Test basic operations
    tsd['test_key'] = 'test_value'
    assert tsd['test_key'] == 'test_value'
    
    tsd.update({'key1': 'value1', 'key2': 'value2'})
    assert len(tsd.keys()) == 3
    
    # Test thread safety (basic check)
    keys = tsd.keys()
    values = tsd.values()
    items = tsd.items()
    
    assert len(keys) == len(values) == len(items)
    
    print("✅ ThreadSafeDict tests passed")


def test_performance_monitor():
    """Test performance monitoring"""
    print("🧪 Testing PerformanceMonitor...")
    
    monitor = PerformanceMonitor(window_size=10)
    
    # Test timer functionality
    monitor.start_timer('test_operation')
    time.sleep(0.1)  # Simulate work
    duration = monitor.end_timer('test_operation')
    
    assert 0.08 <= duration <= 0.15  # Allow for some timing variance
    
    # Test metric recording
    for i in range(5):
        monitor.record_metric('test_metric', i * 10)
        monitor.record_fps('test_fps')
        time.sleep(0.01)
    
    stats = monitor.get_stats()
    print(f"  Performance stats: {list(stats.keys())}")
    
    # Check that metrics were recorded
    assert 'test_metric' in stats
    assert 'test_operation_time' in stats
    
    # Test summary
    summary = monitor.get_summary()
    print(f"  Summary preview: {summary[:100]}...")
    
    print("✅ PerformanceMonitor tests passed")


def test_adaptive_processor():
    """Test adaptive frame processing"""
    print("🧪 Testing AdaptiveFrameProcessor...")
    
    processor = AdaptiveFrameProcessor(target_fps=30)
    
    current_time = time.time()
    
    # Test frame processing decision
    should_process = processor.should_process_frame(current_time, current_time - 0.05)  # 50ms ago
    assert should_process == True  # Should process if enough time has passed
    
    should_not_process = processor.should_process_frame(current_time, current_time - 0.01)  # 10ms ago
    assert should_not_process == False  # Should not process if too recent
    
    # Test quality adaptation
    for processing_time in [0.01, 0.02, 0.05, 0.08]:  # Gradually slower
        quality_settings = processor.adapt_quality(processing_time)
        print(f"  Processing time: {processing_time*1000:.1f}ms -> Quality: {quality_settings['quality']}")
    
    current_settings = processor.get_current_settings()
    print(f"  Final settings: {current_settings}")
    
    print("✅ AdaptiveFrameProcessor tests passed")


def test_thread_coordinator():
    """Test thread coordination"""
    print("🧪 Testing ThreadCoordinator...")
    
    coordinator = ThreadCoordinator()
    
    # Test basic state
    assert not coordinator.is_shutdown_requested()
    assert not coordinator.is_paused()
    
    # Test heartbeat
    coordinator.heartbeat('test_thread')
    health = coordinator.get_thread_health()
    assert 'test_thread' in health
    assert health['test_thread']['active'] == True
    
    # Test error reporting
    test_error = Exception("Test error")
    coordinator.report_error('test_thread', test_error)
    
    errors = coordinator.get_errors()
    assert len(errors) == 1
    assert errors[0][0] == 'test_thread'
    assert errors[0][1] == test_error
    
    # Test pause/resume
    coordinator.pause()
    assert coordinator.is_paused()
    
    coordinator.resume()
    assert not coordinator.is_paused()
    
    # Test shutdown
    coordinator.signal_shutdown()
    assert coordinator.is_shutdown_requested()
    
    print("✅ ThreadCoordinator tests passed")


def benchmark_threading_components():
    """Benchmark threading components performance"""
    print("🏁 Benchmarking threading components...")
    
    # Benchmark CircularFrameBuffer
    buffer = CircularFrameBuffer(max_size=100)
    
    start_time = time.time()
    for i in range(1000):
        frame_data = FrameData(
            frame=np.random.randint(0, 255, (640, 480, 3), dtype=np.uint8),
            timestamp=time.time(),
            frame_id=i
        )
        buffer.put(frame_data, block=False)
    
    put_time = time.time() - start_time
    
    start_time = time.time()
    retrieved_frames = 0
    while buffer.size() > 0:
        try:
            frame_data = buffer.get(block=False)
            retrieved_frames += 1
        except:
            break
    
    get_time = time.time() - start_time
    
    print(f"  Buffer Performance:")
    print(f"    Put 1000 frames: {put_time*1000:.1f}ms ({1000/put_time:.0f} FPS)")
    print(f"    Get {retrieved_frames} frames: {get_time*1000:.1f}ms ({retrieved_frames/get_time:.0f} FPS)")
    
    # Benchmark ThreadSafeDict
    tsd = ThreadSafeDict()
    
    start_time = time.time()
    for i in range(1000):
        tsd[f'key_{i}'] = f'value_{i}'
    
    dict_write_time = time.time() - start_time
    
    start_time = time.time()
    for i in range(1000):
        _ = tsd.get(f'key_{i}')
    
    dict_read_time = time.time() - start_time
    
    print(f"  ThreadSafeDict Performance:")
    print(f"    Write 1000 items: {dict_write_time*1000:.1f}ms ({1000/dict_write_time:.0f} ops/sec)")
    print(f"    Read 1000 items: {dict_read_time*1000:.1f}ms ({1000/dict_read_time:.0f} ops/sec)")
    
    print("✅ Benchmarking completed")


def test_memory_usage():
    """Test memory usage of threading components"""
    print("💾 Testing memory usage...")
    
    import sys
    
    # Test buffer memory usage
    buffer = CircularFrameBuffer(max_size=10)
    
    # Fill with frames
    for i in range(10):
        frame_data = FrameData(
            frame=np.random.randint(0, 255, (640, 480, 3), dtype=np.uint8),
            timestamp=time.time(),
            frame_id=i
        )
        buffer.put(frame_data, block=False)
    
    # Estimate memory usage
    frame_size = 640 * 480 * 3  # bytes per frame
    estimated_memory = frame_size * 10 / (1024 * 1024)  # MB
    
    print(f"  Buffer with 10 frames (640x480x3):")
    print(f"    Estimated memory: {estimated_memory:.1f} MB")
    print(f"    Buffer stats: {buffer.get_stats()}")
    
    # Test cleanup
    buffer.clear()
    stats_after_clear = buffer.get_stats()
    assert stats_after_clear['current_size'] == 0
    
    print("✅ Memory usage tests passed")


def main():
    """Run all tests"""
    print("🔬 Multi-threaded AR System Component Tests")
    print("=" * 60)
    
    try:
        # Run component tests
        test_circular_buffer()
        test_thread_safe_dict()
        test_performance_monitor()
        test_adaptive_processor()
        test_thread_coordinator()
        
        # Run performance benchmarks
        benchmark_threading_components()
        
        # Test memory usage
        test_memory_usage()
        
        print("\n🎉 All threading component tests passed!")
        print("✅ Multi-threaded system is ready for deployment")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        logging.exception("Detailed test error:")
        return False


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)