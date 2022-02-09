from django.shortcuts import render, redirect
from .models import Room, Topic
from .forms import RoomForm
# Create your views here.
# rooms = [
#     {'id':1, 'name':'Lets learn python django'},
#     {'id':2, 'name':'Lets learn React and Ajax'},
#     {'id':3, 'name':'Lets learn python Pivot tables, chart.js and apex charts'},
# ]

def home(request):
    q=request.GET.get('q')
    if request.GET.get('q') == None:
        q=''
    rooms=Room.objects.filter(topic__name__icontains=q)
    topics=Topic.objects.all()
    context={'rooms':rooms, 'topics':topics}
    return render(request, 'base/home.html', context)

def room(request, pk):
    room=Room.objects.get(id=pk)
    context = {'room': room}
    return render(request, 'base/room.html', context)

def create_room(request):
    form = RoomForm()
    if request.method == "POST":
        form = RoomForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect('home')

    context={'form':form}
    return render(request, 'base/room_form.html', context)

def update_room(request, pk):
    room = Room.objects.get(id=pk)
    form = RoomForm(instance=room)

    if request.method == "POST":
        form = RoomForm(request.POST, instance=room)
        if form.is_valid():
            form.save()
            return redirect('home')

    context = {'form':form}
    return render(request, 'base/room_form.html', context)

def delete_room(request, pk):
    room=Room.objects.get(id=pk)
    if request.method == "POST":
        room.delete()
        return redirect('home')
    return render(request, 'base/delete.html', {'obj':room})






