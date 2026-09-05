<script lang="ts">
    // Placeholder component; the real app shell arrives with task 7.
    let {name = 'Homematic Manager'}: {name?: string} = $props();
</script>

<p class="placeholder">{name}</p>

<style>
    .placeholder {
        font-family: sans-serif;
    }
</style>
